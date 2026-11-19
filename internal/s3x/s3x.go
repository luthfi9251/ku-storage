// Package s3x wraps minio-go with exactly the object operations ku-storage
// needs, maps S3 errors to sentinel errors and pools clients per connection.
package s3x

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var (
	ErrNotFound = errors.New("object not found")
	ErrExists   = errors.New("object already exists")
	ErrChanged  = errors.New("object changed concurrently")
	ErrTooMany  = errors.New("too many objects")
)

// PartSize is fixed so memory per upload is bounded and every multipart part
// has the same size (an R2 requirement).
const PartSize = 64 << 20

type Config struct {
	Kind      string // r2 | s3
	AccountID string
	Endpoint  string
	Region    string
	PathStyle bool
	AccessKey string
	SecretKey string
}

// Endpoint returns the resolved URL for the config.
func (c Config) URL() string {
	if c.Kind == "r2" {
		return "https://" + c.AccountID + ".r2.cloudflarestorage.com"
	}
	return c.Endpoint
}

type ObjectInfo struct {
	Key          string
	Size         int64
	LastModified time.Time
	ETag         string
	ContentType  string
	Metadata     map[string]string
}

type Listing struct {
	Folders    []string // full prefixes ending with "/"
	Objects    []ObjectInfo
	NextCursor string
}

// Cond is the precondition of a write.
type Cond int

const (
	CondNone    Cond = iota // create or replace
	CondAbsent              // only if the key does not exist (If-None-Match: *)
	CondPresent             // only if the key exists (stat + If-Match: <etag>)
)

type RemoveError struct {
	Key     string
	Message string
}

// Client is the storage surface used by the API (fakeable in tests).
type Client interface {
	List(ctx context.Context, bucket, prefix, cursor string, max int) (*Listing, error)
	ListAll(ctx context.Context, bucket, prefix string, limit int) ([]string, error)
	Stat(ctx context.Context, bucket, key string) (*ObjectInfo, error)
	Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string, cond Cond) (*ObjectInfo, error)
	Remove(ctx context.Context, bucket string, keys []string) ([]RemoveError, error)
	PresignGet(ctx context.Context, bucket, key string, ttl time.Duration, inline bool) (string, error)
	ListBuckets(ctx context.Context) ([]string, error)
	HeadBucket(ctx context.Context, bucket string) error
}

type client struct {
	c    *minio.Client
	core *minio.Core
}

func New(cfg Config) (Client, error) {
	raw := cfg.URL()
	if cfg.Kind == "r2" && cfg.AccountID == "" {
		return nil, errors.New("account id is required")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("invalid endpoint %q", raw)
	}
	region, lookup := cfg.Region, minio.BucketLookupAuto
	if cfg.Kind == "r2" {
		region, lookup = "auto", minio.BucketLookupPath
	} else if cfg.PathStyle {
		lookup = minio.BucketLookupPath
	}
	opts := &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure:       u.Scheme == "https",
		Region:       region,
		BucketLookup: lookup,
	}
	core, err := minio.NewCore(u.Host, opts)
	if err != nil {
		return nil, err
	}
	return &client{c: core.Client, core: core}, nil
}

func status(err error) int { return minio.ToErrorResponse(err).StatusCode }

func isNotFound(err error) bool {
	r := minio.ToErrorResponse(err)
	return r.StatusCode == http.StatusNotFound || r.Code == "NoSuchKey"
}

func (c *client) List(ctx context.Context, bucket, prefix, cursor string, max int) (*Listing, error) {
	if max <= 0 || max > 1000 {
		max = 1000
	}
	res, err := c.core.ListObjectsV2(bucket, prefix, "", cursor, "/", max)
	if err != nil {
		return nil, err
	}
	out := &Listing{}
	for _, p := range res.CommonPrefixes {
		out.Folders = append(out.Folders, p.Prefix)
	}
	for _, o := range res.Contents {
		out.Objects = append(out.Objects, ObjectInfo{Key: o.Key, Size: o.Size, LastModified: o.LastModified, ETag: strings.Trim(o.ETag, `"`)})
	}
	if res.IsTruncated {
		out.NextCursor = res.NextContinuationToken
	}
	return out, nil
}

func (c *client) ListAll(ctx context.Context, bucket, prefix string, limit int) ([]string, error) {
	var keys []string
	for o := range c.c.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true}) {
		if o.Err != nil {
			return nil, o.Err
		}
		if len(keys) >= limit {
			return nil, ErrTooMany
		}
		keys = append(keys, o.Key)
	}
	return keys, nil
}

func (c *client) Stat(ctx context.Context, bucket, key string) (*ObjectInfo, error) {
	o, err := c.c.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if isNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &ObjectInfo{Key: o.Key, Size: o.Size, LastModified: o.LastModified, ETag: strings.Trim(o.ETag, `"`),
		ContentType: o.ContentType, Metadata: o.UserMetadata}, nil
}

func (c *client) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, contentType string, cond Cond) (*ObjectInfo, error) {
	opts := minio.PutObjectOptions{ContentType: contentType, PartSize: PartSize}
	switch cond {
	case CondAbsent:
		opts.SetMatchETagExcept("*")
	case CondPresent:
		st, err := c.Stat(ctx, bucket, key)
		if err != nil {
			return nil, err
		}
		opts.SetMatchETag(st.ETag)
	}
	info, err := c.c.PutObject(ctx, bucket, key, r, size, opts)
	if err != nil {
		if status(err) == http.StatusPreconditionFailed || minio.ToErrorResponse(err).Code == "PreconditionFailed" {
			if cond == CondAbsent {
				return nil, ErrExists
			}
			return nil, ErrChanged
		}
		return nil, err
	}
	return &ObjectInfo{Key: key, Size: info.Size, ETag: strings.Trim(info.ETag, `"`), LastModified: info.LastModified, ContentType: contentType}, nil
}

func (c *client) Remove(ctx context.Context, bucket string, keys []string) ([]RemoveError, error) {
	ch := make(chan minio.ObjectInfo, len(keys))
	for _, k := range keys {
		ch <- minio.ObjectInfo{Key: k}
	}
	close(ch)
	var errs []RemoveError
	for e := range c.c.RemoveObjects(ctx, bucket, ch, minio.RemoveObjectsOptions{}) {
		if e.Err != nil && !isNotFound(e.Err) {
			errs = append(errs, RemoveError{Key: e.ObjectName, Message: e.Err.Error()})
		}
	}
	return errs, ctx.Err()
}

// textPreview lists extensions previewed as plain text. HTML is included on
// purpose so previews never execute markup, even on the storage origin.
var textPreview = map[string]bool{
	".txt": true, ".md": true, ".log": true, ".csv": true, ".tsv": true, ".json": true, ".xml": true,
	".yaml": true, ".yml": true, ".toml": true, ".ini": true, ".conf": true, ".env": true, ".sql": true,
	".sh": true, ".go": true, ".py": true, ".js": true, ".ts": true, ".tsx": true, ".jsx": true, ".css": true,
	".html": true, ".htm": true, ".java": true, ".c": true, ".h": true, ".rs": true, ".php": true, ".rb": true,
}

// IsTextPreview reports whether a key is previewed as text/plain.
func IsTextPreview(key string) bool { return textPreview[strings.ToLower(path.Ext(key))] }

func (c *client) PresignGet(ctx context.Context, bucket, key string, ttl time.Duration, inline bool) (string, error) {
	params := url.Values{}
	name := path.Base(key)
	if inline {
		params.Set("response-content-disposition", "inline")
		if IsTextPreview(key) {
			params.Set("response-content-type", "text/plain; charset=utf-8")
		}
	} else {
		params.Set("response-content-disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	u, err := c.c.PresignedGetObject(ctx, bucket, key, ttl, params)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (c *client) ListBuckets(ctx context.Context) ([]string, error) {
	bs, err := c.c.ListBuckets(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(bs))
	for _, b := range bs {
		out = append(out, b.Name)
	}
	return out, nil
}

func (c *client) HeadBucket(ctx context.Context, bucket string) error {
	ok, err := c.c.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("bucket %q does not exist", bucket)
	}
	return nil
}

// Message returns a human readable S3 error without request details.
func Message(err error) string {
	r := minio.ToErrorResponse(err)
	if r.Code != "" {
		if r.Message != "" {
			return r.Code + ": " + r.Message
		}
		return r.Code
	}
	return err.Error()
}
