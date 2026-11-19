package api

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/luthfi9251/ku-storage/internal/meta"
)

const minPasswordLen = 10

var usernameRe = regexp.MustCompile(`^[a-z0-9._-]{3,64}$`)

// dummyHash keeps login timing similar for unknown users.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("ku-storage-dummy-password"), bcrypt.DefaultCost)

func normUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validPassword(w http.ResponseWriter, p string) bool {
	if len(p) < minPasswordLen || len(p) > 200 {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "password must be 10-200 characters")
		return false
	}
	return true
}

func hashPassword(p string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
	return string(h), err
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	n, err := s.Store.CountUsers(r.Context())
	if err != nil {
		internalError(w, "count users", err)
		return
	}
	jsonOut(w, http.StatusOK, map[string]bool{"needsSetup": n == 0})
}

type setupRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	var req setupRequest
	if !decodeBody(w, r, &req) {
		return
	}
	req.Username = normUsername(req.Username)
	if !usernameRe.MatchString(req.Username) {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "username must be 3-64 chars of a-z 0-9 . _ -")
		return
	}
	if !validPassword(w, req.Password) {
		return
	}
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	n, err := s.Store.CountUsers(r.Context())
	if err != nil {
		internalError(w, "count users", err)
		return
	}
	if n > 0 {
		fail(w, http.StatusConflict, "ALREADY_SETUP", "admin user already exists")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		internalError(w, "hash", err)
		return
	}
	id, err := s.Store.CreateUser(r.Context(), meta.User{Username: req.Username, DisplayName: strings.TrimSpace(req.DisplayName), PasswordHash: hash, Role: "admin"})
	if err != nil {
		internalError(w, "create admin", err)
		return
	}
	if err := s.startSession(w, r, id); err != nil {
		internalError(w, "session", err)
		return
	}
	u, _ := s.Store.GetUser(r.Context(), id)
	r = withUser(r, u)
	s.audit(r, "user.setup", "ok", nil, "", 0, "initial admin "+u.Username)
	jsonOut(w, http.StatusCreated, map[string]any{"user": toMeUser(u)})
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeBody(w, r, &req) {
		return
	}
	req.Username = normUsername(req.Username)
	key := req.Username + "|" + s.clientIP(r)
	if s.Limiter.Blocked(key) {
		fail(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many failed attempts, try again later")
		return
	}
	u, err := s.Store.GetUserByUsername(r.Context(), req.Username)
	if err != nil && !errors.Is(err, meta.ErrNotFound) {
		internalError(w, "get user", err)
		return
	}
	hash := dummyHash
	if u != nil && !u.Pending() {
		hash = []byte(u.PasswordHash)
	}
	pwOK := bcrypt.CompareHashAndPassword(hash, []byte(req.Password)) == nil
	if u == nil || u.Pending() || u.Disabled || !pwOK {
		s.Limiter.Fail(key)
		s.audit(r, "login_failed", "denied", nil, "", 0, "username: "+req.Username)
		fail(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid username or password")
		return
	}
	s.Limiter.Reset(key)
	if err := s.startSession(w, r, u.ID); err != nil {
		internalError(w, "session", err)
		return
	}
	s.audit(withUser(r, u), "login", "ok", nil, "", 0, "")
	jsonOut(w, http.StatusOK, map[string]any{"user": toMeUser(u)})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if a, err := s.lookup(r); err == nil {
		_ = s.Store.DeleteSession(r.Context(), a.session.ID)
		s.audit(withUser(r, a.user), "logout", "ok", nil, "", 0, "")
	}
	s.clearCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) inviteFromPath(w http.ResponseWriter, r *http.Request) (*meta.Invite, *meta.User, bool) {
	inv, err := s.Store.GetInvite(r.Context(), hashToken(r.PathValue("token")))
	if err == nil {
		var u *meta.User
		if u, err = s.Store.GetUser(r.Context(), inv.UserID); err == nil {
			return inv, u, true
		}
	}
	if errors.Is(err, meta.ErrNotFound) {
		fail(w, http.StatusNotFound, "INVITE_INVALID", "this link is invalid or has expired")
	} else {
		internalError(w, "get invite", err)
	}
	return nil, nil, false
}

func (s *Server) handleGetInvite(w http.ResponseWriter, r *http.Request) {
	inv, u, ok := s.inviteFromPath(w, r)
	if !ok {
		return
	}
	jsonOut(w, http.StatusOK, map[string]string{"username": u.Username, "displayName": u.DisplayName, "purpose": inv.Purpose})
}

func (s *Server) handleUseInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if !decodeBody(w, r, &req) || !validPassword(w, req.Password) {
		return
	}
	inv, u, ok := s.inviteFromPath(w, r)
	if !ok {
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		internalError(w, "hash", err)
		return
	}
	if err := s.Store.UseInvite(r.Context(), inv.ID, u.ID, hash); err != nil {
		if errors.Is(err, meta.ErrNotFound) {
			fail(w, http.StatusNotFound, "INVITE_INVALID", "this link is invalid or has expired")
			return
		}
		internalError(w, "use invite", err)
		return
	}
	s.access.bump()
	if err := s.startSession(w, r, u.ID); err != nil {
		internalError(w, "session", err)
		return
	}
	s.audit(withUser(r, u), "user.password_set", "ok", nil, "", 0, inv.Purpose)
	jsonOut(w, http.StatusOK, map[string]any{"user": toMeUser(u)})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := current(r).user
	a, err := s.accessFor(r.Context(), u)
	if err != nil {
		internalError(w, "access", err)
		return
	}
	eps, err := s.entryPoints(r.Context(), u, a)
	if err != nil {
		internalError(w, "entry points", err)
		return
	}
	jsonOut(w, http.StatusOK, map[string]any{"user": toMeUser(u), "access": eps})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	a := current(r)
	key := "pw|" + a.user.Username
	if s.Limiter.Blocked(key) {
		fail(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many failed attempts, try again later")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(a.user.PasswordHash), []byte(req.CurrentPassword)) != nil {
		s.Limiter.Fail(key)
		fail(w, http.StatusBadRequest, "INVALID_CREDENTIALS", "current password is wrong")
		return
	}
	if !validPassword(w, req.NewPassword) {
		return
	}
	hash, err := hashPassword(req.NewPassword)
	if err != nil {
		internalError(w, "hash", err)
		return
	}
	if err := s.Store.SetPassword(r.Context(), a.user.ID, hash); err != nil {
		internalError(w, "set password", err)
		return
	}
	_ = s.Store.DeleteUserSessions(r.Context(), a.user.ID, a.session.ID)
	s.Limiter.Reset(key)
	s.audit(r, "user.password_change", "ok", nil, "", 0, "")
	w.WriteHeader(http.StatusNoContent)
}

type sessionDTO struct {
	ID         string `json:"id"`
	IP         string `json:"ip"`
	UserAgent  string `json:"userAgent"`
	CreatedAt  string `json:"createdAt"`
	LastSeenAt string `json:"lastSeenAt"`
	Current    bool   `json:"current"`
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	a := current(r)
	ss, err := s.Store.ListSessions(r.Context(), a.user.ID)
	if err != nil {
		internalError(w, "list sessions", err)
		return
	}
	out := []sessionDTO{}
	for _, se := range ss {
		out = append(out, sessionDTO{ID: encID(se.ID), IP: se.IP, UserAgent: se.UserAgent, CreatedAt: ts(se.CreatedAt),
			LastSeenAt: ts(se.LastSeenAt), Current: se.ID == a.session.ID})
	}
	jsonOut(w, http.StatusOK, out)
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	id, err := decID(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "NOT_FOUND", "session not found")
		return
	}
	ok, err := s.Store.DeleteSessionForUser(r.Context(), current(r).user.ID, id)
	if err != nil {
		internalError(w, "delete session", err)
		return
	}
	if !ok {
		fail(w, http.StatusNotFound, "NOT_FOUND", "session not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	a := current(r)
	if err := s.Store.DeleteUserSessions(r.Context(), a.user.ID, a.session.ID); err != nil {
		internalError(w, "revoke sessions", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
