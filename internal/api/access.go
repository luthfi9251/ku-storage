package api

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luthfi9251/ku-storage/internal/authz"
	"github.com/luthfi9251/ku-storage/internal/meta"
)

// accessCache keeps each user's grants for a few seconds. Any change to
// grants, groups, users or buckets bumps the version, invalidating everything
// at once, so revocations apply immediately.
type accessCache struct {
	version atomic.Int64
	mu      sync.Mutex
	entries map[int64]accessEntry
}

type accessEntry struct {
	version int64
	at      time.Time
	grants  []authz.Grant
}

const accessTTL = 5 * time.Second

func newAccessCache() *accessCache { return &accessCache{entries: map[int64]accessEntry{}} }

func (c *accessCache) bump() {
	c.version.Add(1)
	c.mu.Lock()
	c.entries = map[int64]accessEntry{}
	c.mu.Unlock()
}

// access is what a user may do. Admins may do everything on every
// registered bucket.
type access struct {
	admin  bool
	grants []authz.Grant
}

func (a *access) perms(bucketID int64, key string) authz.Perm {
	if a.admin {
		return authz.All
	}
	return authz.Effective(a.grants, bucketID, key)
}

func (a *access) canSee(bucketID int64, prefix string) bool {
	return a.admin || authz.CanSee(a.grants, bucketID, prefix)
}

func toAuthz(gs []meta.Grant) []authz.Grant {
	out := make([]authz.Grant, len(gs))
	for i, g := range gs {
		out[i] = authz.Grant{BucketID: g.BucketID, Prefix: g.Prefix, Perms: authz.Perm(g.Perms)}
	}
	return out
}

func (s *Server) accessFor(ctx context.Context, u *meta.User) (*access, error) {
	if u.IsAdmin() {
		return &access{admin: true}, nil
	}
	v := s.access.version.Load()
	s.access.mu.Lock()
	e, ok := s.access.entries[u.ID]
	s.access.mu.Unlock()
	if ok && e.version == v && time.Since(e.at) < accessTTL {
		return &access{grants: e.grants}, nil
	}
	gs, err := s.Store.UserGrants(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	ag := toAuthz(gs)
	s.access.mu.Lock()
	s.access.entries[u.ID] = accessEntry{version: v, at: time.Now(), grants: ag}
	s.access.mu.Unlock()
	return &access{grants: ag}, nil
}

// entryPoints lists where a user may start browsing.
func (s *Server) entryPoints(ctx context.Context, u *meta.User, a *access) ([]entryPointDTO, error) {
	buckets, err := s.Store.ListBuckets(ctx)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*meta.Bucket{}
	for i := range buckets {
		byID[buckets[i].ID] = &buckets[i]
	}
	out := []entryPointDTO{}
	if a.admin {
		for _, b := range buckets {
			out = append(out, newEntryPoint(&b, "", authz.All))
		}
		return out, nil
	}
	for _, g := range authz.EntryPoints(a.grants) {
		if b := byID[g.BucketID]; b != nil {
			out = append(out, newEntryPoint(b, g.Prefix, g.Perms))
		}
	}
	return out, nil
}

// audit records an entry; failures are logged, never surfaced.
func (s *Server) audit(r *http.Request, action, result string, b *meta.Bucket, key string, size int64, detail string) {
	e := meta.AuditEntry{IP: s.clientIP(r), Action: action, Result: result, Key: key, Size: size, Detail: detail}
	if a := current(r); a != nil {
		e.UserID, e.Username = a.user.ID, a.user.Username
	}
	if b != nil {
		e.BucketID, e.BucketName = b.ID, b.Name
	}
	if len(e.Detail) > 256<<10 {
		e.Detail = e.Detail[:256<<10]
	}
	if err := s.Store.InsertAudit(context.WithoutCancel(r.Context()), e); err != nil {
		internalLog("audit insert", err)
	}
}
