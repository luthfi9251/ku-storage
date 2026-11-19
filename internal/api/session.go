package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/luthfi9251/ku-storage/internal/meta"
)

const sessionCookie = "ku_storage_session"

func newToken() (token, hash string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, hashToken(token)
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

type ctxKey int

const authKey ctxKey = 1

type authInfo struct {
	user    *meta.User
	session *meta.Session
}

func current(r *http.Request) *authInfo {
	a, _ := r.Context().Value(authKey).(*authInfo)
	return a
}

// startSession creates a session and sets the cookie.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID int64) error {
	token, hash := newToken()
	ua := r.UserAgent()
	if len(ua) > 300 {
		ua = ua[:300]
	}
	if _, err := s.Store.CreateSession(r.Context(), hash, userID, s.clientIP(r), ua, sessionTTL); err != nil {
		return err
	}
	_ = s.Store.TouchLogin(r.Context(), userID)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: s.isHTTPS(r), SameSite: http.SameSiteStrictMode, MaxAge: int(sessionMaxAge / time.Second),
	})
	return nil
}

func (s *Server) clearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: s.isHTTPS(r), SameSite: http.SameSiteStrictMode, MaxAge: -1})
}

func (s *Server) lookup(r *http.Request) (*authInfo, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil, meta.ErrNotFound
	}
	se, u, err := s.Store.LookupSession(r.Context(), hashToken(c.Value))
	if err != nil {
		return nil, err
	}
	if u.Pending() {
		return nil, meta.ErrNotFound
	}
	if time.Since(se.LastSeenAt) > time.Minute {
		_ = s.Store.TouchSession(r.Context(), se.ID, s.clientIP(r), sessionTTL, sessionMaxAge)
	}
	return &authInfo{user: u, session: se}, nil
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a, err := s.lookup(r)
		if err != nil {
			if !errors.Is(err, meta.ErrNotFound) {
				internalError(w, "session lookup", err)
				return
			}
			fail(w, http.StatusUnauthorized, "UNAUTHENTICATED", "login required")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), authKey, a)))
	}
}

func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		if !current(r).user.IsAdmin() {
			fail(w, http.StatusForbidden, "FORBIDDEN", "admin only")
			return
		}
		next(w, r)
	})
}

func (s *Server) clientIP(r *http.Request) string {
	if s.Options.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type limiterEntry struct {
	count int
	reset time.Time
}

// RateLimiter counts failed attempts per key in a fixed window.
type RateLimiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	entries map[string]*limiterEntry
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{max: 5, window: 15 * time.Minute, entries: map[string]*limiterEntry{}}
}

// Blocked reports whether key exceeded the allowed failures.
func (r *RateLimiter) Blocked(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[key]
	if !ok || time.Now().After(e.reset) {
		return false
	}
	return e.count >= r.max
}

// Fail records a failed attempt.
func (r *RateLimiter) Fail(key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	e, ok := r.entries[key]
	if !ok || now.After(e.reset) {
		r.entries[key] = &limiterEntry{count: 1, reset: now.Add(r.window)}
		return
	}
	e.count++
}

func (r *RateLimiter) Reset(key string) {
	r.mu.Lock()
	delete(r.entries, key)
	r.mu.Unlock()
}

// Sweep drops expired entries.
func (r *RateLimiter) Sweep() {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for k, e := range r.entries {
		if now.After(e.reset) {
			delete(r.entries, k)
		}
	}
}

// withUser attaches a user (without session) for audit purposes on
// unauthenticated routes such as login.
func withUser(r *http.Request, u *meta.User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), authKey, &authInfo{user: u, session: &meta.Session{}}))
}
