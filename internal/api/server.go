// Package api serves the ku-storage JSON API. Every object operation goes
// through Server.perms (internal/authz) before reaching storage.
package api

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/luthfi9251/ku-storage/internal/cryptx"
	"github.com/luthfi9251/ku-storage/internal/meta"
	"github.com/luthfi9251/ku-storage/internal/s3x"
)

// Storage resolves a storage client for a connection id.
type Storage interface {
	Get(ctx context.Context, connID int64) (s3x.Client, error)
	Invalidate(connID int64)
}

type Options struct {
	PublicURL  string // e.g. https://files.example.com; empty = derive from request
	TrustProxy bool   // trust X-Forwarded-For / X-Forwarded-Proto
	MaxUpload  int64  // bytes per file
	PresignTTL time.Duration
}

type Deps struct {
	Store   *meta.Store
	Crypt   *cryptx.Cryptx
	Storage Storage
	Limiter *RateLimiter
	Options Options
}

type Server struct {
	Deps
	mux     *http.ServeMux
	access  *accessCache
	setupMu sync.Mutex
}

const (
	sessionTTL    = 24 * time.Hour
	sessionMaxAge = 7 * 24 * time.Hour
	inviteTTL     = 72 * time.Hour
	maxDeleteKeys = 1000
	maxFolderObjs = 10000
	pageSize      = 1000
)

func NewServer(d Deps) http.Handler {
	if d.Limiter == nil {
		d.Limiter = NewRateLimiter()
	}
	if d.Options.MaxUpload <= 0 {
		d.Options.MaxUpload = 5 << 30
	}
	if d.Options.PresignTTL <= 0 {
		d.Options.PresignTTL = 5 * time.Minute
	}
	s := &Server{Deps: d, mux: http.NewServeMux(), access: newAccessCache()}
	s.routes()
	return s.withLogging(s.withOriginCheck(s.mux))
}

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	m.HandleFunc("POST /api/auth/setup", s.handleSetup)
	m.HandleFunc("POST /api/auth/login", s.handleLogin)
	m.HandleFunc("POST /api/auth/logout", s.handleLogout)
	m.HandleFunc("GET /api/invites/{token}", s.handleGetInvite)
	m.HandleFunc("POST /api/invites/{token}", s.handleUseInvite)

	m.HandleFunc("GET /api/me", s.auth(s.handleMe))
	m.HandleFunc("PUT /api/me/password", s.auth(s.handleChangePassword))
	m.HandleFunc("GET /api/me/sessions", s.auth(s.handleListSessions))
	m.HandleFunc("DELETE /api/me/sessions/{id}", s.auth(s.handleDeleteSession))
	m.HandleFunc("POST /api/me/sessions/revoke-others", s.auth(s.handleRevokeOtherSessions))

	m.HandleFunc("GET /api/browse", s.auth(s.handleBrowse))
	m.HandleFunc("GET /api/objects/stat", s.auth(s.handleStat))
	m.HandleFunc("GET /api/objects/download", s.auth(s.handleDownload))
	m.HandleFunc("PUT /api/objects", s.auth(s.handleUpload))
	m.HandleFunc("POST /api/folders", s.auth(s.handleCreateFolder))
	m.HandleFunc("POST /api/objects/delete", s.auth(s.handleDelete))

	m.HandleFunc("GET /api/admin/users", s.admin(s.handleListUsers))
	m.HandleFunc("POST /api/admin/users", s.admin(s.handleCreateUser))
	m.HandleFunc("PUT /api/admin/users/{id}", s.admin(s.handleUpdateUser))
	m.HandleFunc("POST /api/admin/users/{id}/reset", s.admin(s.handleResetUser))
	m.HandleFunc("DELETE /api/admin/users/{id}", s.admin(s.handleDeleteUser))
	m.HandleFunc("GET /api/admin/users/{id}/access", s.admin(s.handleUserAccess))

	m.HandleFunc("GET /api/admin/groups", s.admin(s.handleListGroups))
	m.HandleFunc("POST /api/admin/groups", s.admin(s.handleCreateGroup))
	m.HandleFunc("PUT /api/admin/groups/{id}", s.admin(s.handleUpdateGroup))
	m.HandleFunc("DELETE /api/admin/groups/{id}", s.admin(s.handleDeleteGroup))

	m.HandleFunc("GET /api/admin/connections", s.admin(s.handleListConnections))
	m.HandleFunc("POST /api/admin/connections", s.admin(s.handleCreateConnection))
	m.HandleFunc("PUT /api/admin/connections/{id}", s.admin(s.handleUpdateConnection))
	m.HandleFunc("DELETE /api/admin/connections/{id}", s.admin(s.handleDeleteConnection))
	m.HandleFunc("POST /api/admin/connections/{id}/discover", s.admin(s.handleDiscover))

	m.HandleFunc("GET /api/admin/buckets", s.admin(s.handleListBuckets))
	m.HandleFunc("POST /api/admin/buckets", s.admin(s.handleCreateBucket))
	m.HandleFunc("PUT /api/admin/buckets/{id}", s.admin(s.handleUpdateBucket))
	m.HandleFunc("DELETE /api/admin/buckets/{id}", s.admin(s.handleDeleteBucket))
	m.HandleFunc("POST /api/admin/buckets/{id}/test", s.admin(s.handleTestBucket))

	m.HandleFunc("GET /api/admin/grants", s.admin(s.handleListGrants))
	m.HandleFunc("POST /api/admin/grants", s.admin(s.handleCreateGrant))
	m.HandleFunc("PUT /api/admin/grants/{id}", s.admin(s.handleUpdateGrant))
	m.HandleFunc("DELETE /api/admin/grants/{id}", s.admin(s.handleDeleteGrant))

	m.HandleFunc("GET /api/admin/audit", s.admin(s.handleListAudit))
	m.HandleFunc("GET /api/admin/audit.csv", s.admin(s.handleAuditCSV))

	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "NOT_FOUND", "route not found")
	})
}

// isHTTPS reports whether the client talks to us over TLS.
func (s *Server) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if s.Options.TrustProxy && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return strings.HasPrefix(s.Options.PublicURL, "https://")
}

// expectedOrigin is the origin browsers must send on state-changing requests.
func (s *Server) expectedOrigin(r *http.Request) string {
	if s.Options.PublicURL != "" {
		if u, err := url.Parse(s.Options.PublicURL); err == nil {
			return u.Scheme + "://" + u.Host
		}
	}
	scheme := "http"
	if r.TLS != nil || (s.Options.TrustProxy && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")) {
		scheme = "https"
	}
	host := r.Host
	if s.Options.TrustProxy && r.Header.Get("X-Forwarded-Host") != "" {
		host = r.Header.Get("X-Forwarded-Host")
	}
	return scheme + "://" + host
}

// withOriginCheck is the CSRF defence (next to SameSite=Strict cookies):
// state-changing requests must carry a matching Origin header.
func (s *Server) withOriginCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			if o := r.Header.Get("Origin"); o == "" || !strings.EqualFold(o, s.expectedOrigin(r)) {
				fail(w, http.StatusForbidden, "BAD_ORIGIN", "cross-origin request rejected")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		w.Header().Set("Cache-Control", "no-store")
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if p := recover(); p != nil {
				log.Printf("panic %s %s: %v", r.Method, r.URL.Path, p)
				fail(rec, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
		}()
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start))
	})
}

func internalError(w http.ResponseWriter, what string, err error) {
	log.Printf("%s: %v", what, err)
	fail(w, http.StatusInternalServerError, "INTERNAL", "internal error")
}
