package api

import (
	"context"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/luthfi9251/ku-storage/internal/s3x"
)

// fakeStorage is an in-memory s3x.Client shared by every connection.
type fakeStorage struct {
	mu      sync.Mutex
	objects map[string]map[string]s3x.ObjectInfo // bucket -> key -> info
	data    map[string]string
}

func newFakeStorage() *fakeStorage {
	return &fakeStorage{objects: map[string]map[string]s3x.ObjectInfo{}, data: map[string]string{}}
}

func (f *fakeStorage) Get(ctx context.Context, connID int64) (s3x.Client, error) { return f, nil }
func (f *fakeStorage) Invalidate(int64)                                          {}

func (f *fakeStorage) put(bucket, key, body string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.objects[bucket] == nil {
		f.objects[bucket] = map[string]s3x.ObjectInfo{}
	}
	f.objects[bucket][key] = s3x.ObjectInfo{Key: key, Size: int64(len(body)), LastModified: time.Unix(1_800_000_000, 0), ETag: "e" + body}
	f.data[bucket+"/"+key] = body
}

func (f *fakeStorage) has(bucket, key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.objects[bucket][key]
	return ok
}

func (f *fakeStorage) List(ctx context.Context, bucket, prefix, cursor string, max int) (*s3x.Listing, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var keys []string
	for k := range f.objects[bucket] {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	out := &s3x.Listing{}
	seen := map[string]bool{}
	for _, k := range keys {
		rest := k[len(prefix):]
		if i := strings.IndexByte(rest, '/'); i >= 0 {
			p := prefix + rest[:i+1]
			if p == prefix {
				out.Objects = append(out.Objects, f.objects[bucket][k])
				continue
			}
			if !seen[p] {
				seen[p] = true
				out.Folders = append(out.Folders, p)
			}
			continue
		}
		out.Objects = append(out.Objects, f.objects[bucket][k])
	}
	return out, nil
}

func (f *fakeStorage) ListAll(ctx context.Context, bucket, prefix string, limit int) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var keys []string
	for k := range f.objects[bucket] {
		if strings.HasPrefix(k, prefix) {
			if len(keys) >= limit {
				return nil, s3x.ErrTooMany
			}
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys, nil
}

func (f *fakeStorage) Stat(ctx context.Context, bucket, key string) (*s3x.ObjectInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.objects[bucket][key]
	if !ok {
		return nil, s3x.ErrNotFound
	}
	return &o, nil
}

func (f *fakeStorage) Put(ctx context.Context, bucket, key string, r io.Reader, size int64, ct string, cond s3x.Cond) (*s3x.ObjectInfo, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	exists := f.has(bucket, key)
	if cond == s3x.CondAbsent && exists {
		return nil, s3x.ErrExists
	}
	if cond == s3x.CondPresent && !exists {
		return nil, s3x.ErrNotFound
	}
	f.put(bucket, key, string(b))
	return &s3x.ObjectInfo{Key: key, Size: int64(len(b)), ETag: "e"}, nil
}

func (f *fakeStorage) Remove(ctx context.Context, bucket string, keys []string) ([]s3x.RemoveError, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, k := range keys {
		delete(f.objects[bucket], k)
	}
	return nil, nil
}

func (f *fakeStorage) PresignGet(ctx context.Context, bucket, key string, ttl time.Duration, inline bool) (string, error) {
	return "https://storage.example/" + bucket + "/" + key + "?sig=1", nil
}

func (f *fakeStorage) ListBuckets(ctx context.Context) ([]string, error) {
	return []string{"assets"}, nil
}
func (f *fakeStorage) HeadBucket(ctx context.Context, bucket string) error { return nil }
