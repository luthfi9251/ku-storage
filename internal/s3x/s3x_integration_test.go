//go:build integration

// Integration tests against a real S3-compatible endpoint.
//
// MinIO:  KUSTORAGE_TEST_KIND=s3 KUSTORAGE_TEST_ENDPOINT=http://127.0.0.1:9000
//
//	KUSTORAGE_TEST_ACCESS_KEY=minioadmin KUSTORAGE_TEST_SECRET_KEY=minioadmin
//	KUSTORAGE_TEST_BUCKET=kus-test KUSTORAGE_TEST_CREATE_BUCKET=1
//
// R2:     KUSTORAGE_TEST_KIND=r2 KUSTORAGE_TEST_ACCOUNT_ID=... plus keys and an
//
//	        existing, disposable KUSTORAGE_TEST_BUCKET.
//
//		go test -tags integration ./internal/s3x/
package s3x

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func testClient(t *testing.T) (Client, string) {
	t.Helper()
	cfg := Config{
		Kind:      os.Getenv("KUSTORAGE_TEST_KIND"),
		AccountID: os.Getenv("KUSTORAGE_TEST_ACCOUNT_ID"),
		Endpoint:  os.Getenv("KUSTORAGE_TEST_ENDPOINT"),
		Region:    os.Getenv("KUSTORAGE_TEST_REGION"),
		PathStyle: true,
		AccessKey: os.Getenv("KUSTORAGE_TEST_ACCESS_KEY"),
		SecretKey: os.Getenv("KUSTORAGE_TEST_SECRET_KEY"),
	}
	bucket := os.Getenv("KUSTORAGE_TEST_BUCKET")
	if cfg.Kind == "" || bucket == "" {
		t.Skip("KUSTORAGE_TEST_* not set")
	}
	c, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("KUSTORAGE_TEST_CREATE_BUCKET") == "1" {
		u := strings.TrimPrefix(strings.TrimPrefix(cfg.Endpoint, "http://"), "https://")
		mc, _ := minio.New(u, &minio.Options{Creds: credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""), Secure: strings.HasPrefix(cfg.Endpoint, "https")})
		if ok, _ := mc.BucketExists(context.Background(), bucket); !ok {
			if err := mc.MakeBucket(context.Background(), bucket, minio.MakeBucketOptions{}); err != nil {
				t.Fatal(err)
			}
		}
	}
	return c, bucket
}

func runPrefix(t *testing.T) string {
	b := make([]byte, 6)
	rand.Read(b)
	return "ku-storage-it-" + hex.EncodeToString(b) + "/"
}

func cleanup(t *testing.T, c Client, bucket, prefix string) {
	t.Cleanup(func() {
		keys, err := c.ListAll(context.Background(), bucket, prefix, 100000)
		if err == nil && len(keys) > 0 {
			c.Remove(context.Background(), bucket, keys)
		}
	})
}

func TestConditionalPut(t *testing.T) {
	c, bucket := testClient(t)
	ctx := context.Background()
	p := runPrefix(t)
	cleanup(t, c, bucket, p)
	key := p + "a.txt"

	if _, err := c.Put(ctx, bucket, key, strings.NewReader("one"), 3, "text/plain", CondPresent); !errors.Is(err, ErrNotFound) {
		t.Fatalf("present on missing: %v", err)
	}
	if _, err := c.Put(ctx, bucket, key, strings.NewReader("one"), 3, "text/plain", CondAbsent); err != nil {
		t.Fatalf("absent on missing: %v", err)
	}
	if _, err := c.Put(ctx, bucket, key, strings.NewReader("two"), 3, "text/plain", CondAbsent); !errors.Is(err, ErrExists) {
		t.Fatalf("absent on existing: %v", err)
	}
	if _, err := c.Put(ctx, bucket, key, strings.NewReader("three"), 5, "text/plain", CondPresent); err != nil {
		t.Fatalf("present on existing: %v", err)
	}
	st, err := c.Stat(ctx, bucket, key)
	if err != nil || st.Size != 5 || st.ContentType != "text/plain" {
		t.Fatalf("stat = %+v, %v", st, err)
	}
	if _, err := c.Stat(ctx, bucket, p+"missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stat missing: %v", err)
	}
}

// zeroReader is not an io.ReaderAt, like an HTTP request body.
type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestConditionalMultipart(t *testing.T) {
	if testing.Short() {
		t.Skip("large upload")
	}
	c, bucket := testClient(t)
	ctx := context.Background()
	p := runPrefix(t)
	cleanup(t, c, bucket, p)
	key := p + "big.bin"
	size := int64(PartSize + 5<<20) // two parts
	if _, err := c.Put(ctx, bucket, key, io.LimitReader(zeroReader{}, size), size, "application/octet-stream", CondAbsent); err != nil {
		t.Fatalf("multipart create: %v", err)
	}
	if _, err := c.Put(ctx, bucket, key, io.LimitReader(zeroReader{}, size), size, "application/octet-stream", CondAbsent); !errors.Is(err, ErrExists) {
		t.Fatalf("multipart create over existing: %v", err)
	}
	st, err := c.Stat(ctx, bucket, key)
	if err != nil || st.Size != size {
		t.Fatalf("stat = %+v, %v", st, err)
	}
}

func TestListPagingAndRemove(t *testing.T) {
	c, bucket := testClient(t)
	ctx := context.Background()
	p := runPrefix(t)
	cleanup(t, c, bucket, p)
	for _, k := range []string{"a.txt", "b.txt", "dir/x.txt", "dir/sub/y.txt", "empty/"} {
		if _, err := c.Put(ctx, bucket, p+k, strings.NewReader(""), 0, "text/plain", CondNone); err != nil {
			t.Fatal(err)
		}
	}
	var folders, objects []string
	cursor := ""
	for pages := 0; ; pages++ {
		l, err := c.List(ctx, bucket, p, cursor, 2)
		if err != nil {
			t.Fatal(err)
		}
		folders = append(folders, l.Folders...)
		for _, o := range l.Objects {
			objects = append(objects, o.Key)
		}
		if l.NextCursor == "" {
			break
		}
		if pages > 5 {
			t.Fatal("paging does not end")
		}
		cursor = l.NextCursor
	}
	if strings.Join(folders, ",") != p+"dir/,"+p+"empty/" || strings.Join(objects, ",") != p+"a.txt,"+p+"b.txt" {
		t.Fatalf("folders=%v objects=%v", folders, objects)
	}
	if _, err := c.ListAll(ctx, bucket, p+"dir/", 1); !errors.Is(err, ErrTooMany) {
		t.Fatalf("ListAll limit: %v", err)
	}
	keys, err := c.ListAll(ctx, bucket, p+"dir/", 10)
	if err != nil || len(keys) != 2 {
		t.Fatalf("ListAll = %v, %v", keys, err)
	}
	errs, err := c.Remove(ctx, bucket, append(keys, p+"never-existed"))
	if err != nil || len(errs) != 0 {
		t.Fatalf("remove: %v %v", errs, err)
	}
	if rest, _ := c.ListAll(ctx, bucket, p+"dir/", 10); len(rest) != 0 {
		t.Fatalf("left after remove: %v", rest)
	}
}

func TestPresign(t *testing.T) {
	c, bucket := testClient(t)
	ctx := context.Background()
	p := runPrefix(t)
	cleanup(t, c, bucket, p)
	key := p + "laporan akhir.html"
	if _, err := c.Put(ctx, bucket, key, strings.NewReader("<b>hi</b>"), 9, "text/html", CondNone); err != nil {
		t.Fatal(err)
	}
	get := func(inline bool) *http.Response {
		u, err := c.PresignGet(ctx, bucket, key, time.Minute, inline)
		if err != nil {
			t.Fatal(err)
		}
		res, err := http.Get(u)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("presigned GET = %d", res.StatusCode)
		}
		return res
	}
	dl := get(false)
	if cd := dl.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") || !strings.Contains(cd, "laporan") {
		t.Fatalf("download disposition = %q", cd)
	}
	pv := get(true)
	if cd := pv.Header.Get("Content-Disposition"); cd != "inline" {
		t.Fatalf("preview disposition = %q", cd)
	}
	if ct := pv.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("html must preview as text, got %q", ct)
	}
}

func TestBuckets(t *testing.T) {
	c, bucket := testClient(t)
	if err := c.HeadBucket(context.Background(), bucket); err != nil {
		t.Fatal(err)
	}
	if err := c.HeadBucket(context.Background(), "ku-storage-does-not-exist-123"); err == nil {
		t.Fatal("missing bucket should fail")
	}
}
