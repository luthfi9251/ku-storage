package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/luthfi9251/ku-storage/internal/authz"
	"github.com/luthfi9251/ku-storage/internal/meta"
)

// pathID decodes {id}; writes 404 on failure.
func pathID(w http.ResponseWriter, r *http.Request, what string) (int64, bool) {
	id, err := decID(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "NOT_FOUND", what+" not found")
		return 0, false
	}
	return id, true
}

func decIDs(w http.ResponseWriter, in []string) ([]int64, bool) {
	out := make([]int64, 0, len(in))
	for _, s := range in {
		id, err := decID(s)
		if err != nil {
			fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid id "+s)
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}

func storeError(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, meta.ErrNotFound):
		fail(w, http.StatusNotFound, "NOT_FOUND", what+" not found")
	case errors.Is(err, meta.ErrConflict):
		fail(w, http.StatusConflict, "CONFLICT", what+" already exists")
	case errors.Is(err, meta.ErrLastAdmin):
		fail(w, http.StatusConflict, "LAST_ADMIN", "at least one active admin is required")
	default:
		internalError(w, what, err)
	}
}

func validRole(w http.ResponseWriter, role string) bool {
	if role != "admin" && role != "user" {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "role must be admin or user")
		return false
	}
	return true
}

// userDTOs builds DTOs with group refs for the given users.
func (s *Server) userDTOs(r *http.Request, users []meta.User) ([]userDTO, error) {
	groups, err := s.Store.ListGroups(r.Context())
	if err != nil {
		return nil, err
	}
	byUser := map[int64][]groupRefDTO{}
	for _, g := range groups {
		for _, m := range g.Members {
			byUser[m] = append(byUser[m], groupRefDTO{ID: encID(g.ID), Name: g.Name})
		}
	}
	out := make([]userDTO, 0, len(users))
	for i := range users {
		out = append(out, toUserDTO(&users[i], byUser[users[i].ID]))
	}
	return out, nil
}

func (s *Server) oneUserDTO(w http.ResponseWriter, r *http.Request, id int64) (userDTO, bool) {
	u, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		storeError(w, "user", err)
		return userDTO{}, false
	}
	ds, err := s.userDTOs(r, []meta.User{*u})
	if err != nil {
		internalError(w, "user dto", err)
		return userDTO{}, false
	}
	return ds[0], true
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Store.ListUsers(r.Context())
	if err != nil {
		internalError(w, "list users", err)
		return
	}
	out, err := s.userDTOs(r, users)
	if err != nil {
		internalError(w, "user dto", err)
		return
	}
	jsonOut(w, http.StatusOK, out)
}

type inviteDTO struct {
	InvitePath string `json:"invitePath"`
	ExpiresAt  string `json:"expiresAt"`
}

func (s *Server) newInvite(r *http.Request, userID int64, purpose string) (inviteDTO, error) {
	token, hash := newToken()
	exp, err := s.Store.CreateInvite(r.Context(), hash, userID, purpose, inviteTTL)
	if err != nil {
		return inviteDTO{}, err
	}
	return inviteDTO{InvitePath: "/invite/" + token, ExpiresAt: ts(exp)}, nil
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string   `json:"username"`
		DisplayName string   `json:"displayName"`
		Role        string   `json:"role"`
		GroupIDs    []string `json:"groupIds"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	req.Username = normUsername(req.Username)
	if !usernameRe.MatchString(req.Username) {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "username must be 3-64 chars of a-z 0-9 . _ -")
		return
	}
	if !validRole(w, req.Role) {
		return
	}
	gids, ok := decIDs(w, req.GroupIDs)
	if !ok {
		return
	}
	id, err := s.Store.CreateUser(r.Context(), meta.User{Username: req.Username, DisplayName: strings.TrimSpace(req.DisplayName), Role: req.Role})
	if err != nil {
		storeError(w, "user", err)
		return
	}
	if err := s.Store.SetUserGroups(r.Context(), id, gids); err != nil {
		internalError(w, "set groups", err)
		return
	}
	s.access.bump()
	inv, err := s.newInvite(r, id, "invite")
	if err != nil {
		internalError(w, "invite", err)
		return
	}
	s.audit(r, "user.create", "ok", nil, "", 0, req.Username+" ("+req.Role+")")
	d, ok := s.oneUserDTO(w, r, id)
	if !ok {
		return
	}
	jsonOut(w, http.StatusCreated, map[string]any{"user": d, "invite": inv})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "user")
	if !ok {
		return
	}
	var req struct {
		DisplayName string   `json:"displayName"`
		Role        string   `json:"role"`
		Disabled    bool     `json:"disabled"`
		GroupIDs    []string `json:"groupIds"`
	}
	if !decodeBody(w, r, &req) || !validRole(w, req.Role) {
		return
	}
	gids, ok := decIDs(w, req.GroupIDs)
	if !ok {
		return
	}
	if err := s.Store.UpdateUser(r.Context(), id, strings.TrimSpace(req.DisplayName), req.Role, req.Disabled, gids); err != nil {
		storeError(w, "user", err)
		return
	}
	if req.Disabled {
		_ = s.Store.DeleteUserSessions(r.Context(), id, 0)
	}
	s.access.bump()
	d, ok := s.oneUserDTO(w, r, id)
	if !ok {
		return
	}
	detail := d.Username + " role=" + req.Role
	if req.Disabled {
		detail += " disabled"
	}
	s.audit(r, "user.update", "ok", nil, "", 0, detail)
	jsonOut(w, http.StatusOK, d)
}

func (s *Server) handleResetUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "user")
	if !ok {
		return
	}
	u, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		storeError(w, "user", err)
		return
	}
	purpose := "reset"
	if u.Pending() {
		purpose = "invite"
	}
	inv, err := s.newInvite(r, id, purpose)
	if err != nil {
		internalError(w, "invite", err)
		return
	}
	_ = s.Store.DeleteUserSessions(r.Context(), id, 0)
	s.audit(r, "user.reset", "ok", nil, "", 0, u.Username)
	jsonOut(w, http.StatusOK, inv)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "user")
	if !ok {
		return
	}
	u, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		storeError(w, "user", err)
		return
	}
	if err := s.Store.DeleteUser(r.Context(), id); err != nil {
		storeError(w, "user", err)
		return
	}
	s.access.bump()
	s.audit(r, "user.delete", "ok", nil, "", 0, u.Username)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUserAccess(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "user")
	if !ok {
		return
	}
	u, err := s.Store.GetUser(r.Context(), id)
	if err != nil {
		storeError(w, "user", err)
		return
	}
	gs, err := s.Store.UserGrants(r.Context(), id)
	if err != nil {
		internalError(w, "grants", err)
		return
	}
	out := []grantDTO{}
	for i := range gs {
		d := toGrantDTO(&gs[i])
		d.Via = gs[i].SubjectType
		out = append(out, d)
	}
	a := &access{admin: u.IsAdmin(), grants: toAuthz(gs)}
	eps, err := s.entryPoints(r.Context(), u, a)
	if err != nil {
		internalError(w, "entry points", err)
		return
	}
	jsonOut(w, http.StatusOK, map[string]any{"grants": out, "access": eps})
}

// ---- groups ----

func (s *Server) groupDTOs(r *http.Request) ([]groupDTO, error) {
	groups, err := s.Store.ListGroups(r.Context())
	if err != nil {
		return nil, err
	}
	users, err := s.Store.ListUsers(r.Context())
	if err != nil {
		return nil, err
	}
	byID := map[int64]*meta.User{}
	for i := range users {
		byID[users[i].ID] = &users[i]
	}
	out := []groupDTO{}
	for _, g := range groups {
		d := groupDTO{ID: encID(g.ID), Name: g.Name, CreatedAt: ts(g.CreatedAt), Members: []memberDTO{}}
		for _, m := range g.Members {
			if u := byID[m]; u != nil {
				d.Members = append(d.Members, memberDTO{ID: encID(u.ID), Username: u.Username, DisplayName: u.DisplayName})
			}
		}
		out = append(out, d)
	}
	return out, nil
}

func (s *Server) writeGroup(w http.ResponseWriter, r *http.Request, id int64, status int) {
	gs, err := s.groupDTOs(r)
	if err != nil {
		internalError(w, "groups", err)
		return
	}
	for _, g := range gs {
		if g.ID == encID(id) {
			jsonOut(w, status, g)
			return
		}
	}
	fail(w, http.StatusNotFound, "NOT_FOUND", "group not found")
}

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	gs, err := s.groupDTOs(r)
	if err != nil {
		internalError(w, "groups", err)
		return
	}
	jsonOut(w, http.StatusOK, gs)
}

type groupRequest struct {
	Name      string   `json:"name"`
	MemberIDs []string `json:"memberIds"`
}

func (s *Server) decodeGroup(w http.ResponseWriter, r *http.Request) (string, []int64, bool) {
	var req groupRequest
	if !decodeBody(w, r, &req) {
		return "", nil, false
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 100 {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "group name is required (max 100 chars)")
		return "", nil, false
	}
	ids, ok := decIDs(w, req.MemberIDs)
	return name, ids, ok
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	name, members, ok := s.decodeGroup(w, r)
	if !ok {
		return
	}
	id, err := s.Store.CreateGroup(r.Context(), name, members)
	if err != nil {
		storeError(w, "group", err)
		return
	}
	s.access.bump()
	s.audit(r, "group.create", "ok", nil, "", 0, name)
	s.writeGroup(w, r, id, http.StatusCreated)
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "group")
	if !ok {
		return
	}
	name, members, ok := s.decodeGroup(w, r)
	if !ok {
		return
	}
	if err := s.Store.UpdateGroup(r.Context(), id, name, members); err != nil {
		storeError(w, "group", err)
		return
	}
	s.access.bump()
	s.audit(r, "group.update", "ok", nil, "", 0, name)
	s.writeGroup(w, r, id, http.StatusOK)
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "group")
	if !ok {
		return
	}
	g, err := s.Store.GetGroup(r.Context(), id)
	if err != nil {
		storeError(w, "group", err)
		return
	}
	if err := s.Store.DeleteGroup(r.Context(), id); err != nil {
		storeError(w, "group", err)
		return
	}
	s.access.bump()
	s.audit(r, "group.delete", "ok", nil, "", 0, g.Name)
	w.WriteHeader(http.StatusNoContent)
}

// ---- grants ----

func (s *Server) handleListGrants(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var f meta.GrantFilter
	var err error
	if v := q.Get("bucket"); v != "" {
		if f.BucketID, err = decID(v); err != nil {
			fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid bucket")
			return
		}
	}
	if v := q.Get("subjectType"); v != "" {
		f.SubjectType = v
	}
	if v := q.Get("subjectId"); v != "" {
		if f.SubjectID, err = decID(v); err != nil {
			fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid subject")
			return
		}
	}
	gs, err := s.Store.ListGrants(r.Context(), f)
	if err != nil {
		internalError(w, "grants", err)
		return
	}
	out := []grantDTO{}
	for i := range gs {
		out = append(out, toGrantDTO(&gs[i]))
	}
	jsonOut(w, http.StatusOK, out)
}

func validPerms(w http.ResponseWriter, p permsDTO) (authz.Perm, bool) {
	perm := p.perm()
	if !perm.Valid() {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "read is required and at least one permission must be set")
		return 0, false
	}
	return perm, true
}

func validPrefix(w http.ResponseWriter, p string) (string, bool) {
	n, err := authz.NormalizePrefix(strings.TrimSpace(p))
	if err != nil {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid prefix")
		return "", false
	}
	return n, true
}

func grantDetail(g *meta.Grant) string {
	p := toPermsDTO(authz.Perm(g.Perms))
	var ps []string
	for _, x := range []struct {
		on   bool
		name string
	}{{p.Read, "read"}, {p.Create, "create"}, {p.Update, "update"}, {p.Delete, "delete"}} {
		if x.on {
			ps = append(ps, x.name)
		}
	}
	return g.SubjectType + ":" + g.SubjectName + " prefix=" + g.Prefix + " perms=" + strings.Join(ps, ",")
}

func (s *Server) handleCreateGrant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SubjectType string   `json:"subjectType"`
		SubjectID   string   `json:"subjectId"`
		BucketID    string   `json:"bucketId"`
		Prefix      string   `json:"prefix"`
		Perms       permsDTO `json:"perms"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.SubjectType != "user" && req.SubjectType != "group" {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "subjectType must be user or group")
		return
	}
	sid, err1 := decID(req.SubjectID)
	bid, err2 := decID(req.BucketID)
	if err1 != nil || err2 != nil {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid subject or bucket")
		return
	}
	perm, ok := validPerms(w, req.Perms)
	if !ok {
		return
	}
	prefix, ok := validPrefix(w, req.Prefix)
	if !ok {
		return
	}
	if exists, err := s.Store.SubjectExists(r.Context(), req.SubjectType, sid); err != nil || !exists {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", req.SubjectType+" not found")
		return
	}
	b, err := s.Store.GetBucket(r.Context(), bid)
	if err != nil {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "bucket not found")
		return
	}
	id, err := s.Store.UpsertGrant(r.Context(), meta.Grant{SubjectType: req.SubjectType, SubjectID: sid, BucketID: bid, Prefix: prefix, Perms: uint8(perm)}, current(r).user.ID)
	if err != nil {
		internalError(w, "upsert grant", err)
		return
	}
	s.access.bump()
	g, err := s.Store.GetGrant(r.Context(), id)
	if err != nil {
		internalError(w, "get grant", err)
		return
	}
	s.audit(r, "grant.create", "ok", b, prefix, 0, grantDetail(g))
	jsonOut(w, http.StatusCreated, toGrantDTO(g))
}

func (s *Server) handleUpdateGrant(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "grant")
	if !ok {
		return
	}
	var req struct {
		Prefix string   `json:"prefix"`
		Perms  permsDTO `json:"perms"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	perm, ok := validPerms(w, req.Perms)
	if !ok {
		return
	}
	prefix, ok := validPrefix(w, req.Prefix)
	if !ok {
		return
	}
	if err := s.Store.UpdateGrant(r.Context(), id, prefix, uint8(perm)); err != nil {
		if errors.Is(err, meta.ErrConflict) {
			fail(w, http.StatusConflict, "CONFLICT", "this subject already has a grant on that prefix")
			return
		}
		storeError(w, "grant", err)
		return
	}
	s.access.bump()
	g, err := s.Store.GetGrant(r.Context(), id)
	if err != nil {
		storeError(w, "grant", err)
		return
	}
	s.audit(r, "grant.update", "ok", &meta.Bucket{ID: g.BucketID, Name: g.BucketName}, g.Prefix, 0, grantDetail(g))
	jsonOut(w, http.StatusOK, toGrantDTO(g))
}

func (s *Server) handleDeleteGrant(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "grant")
	if !ok {
		return
	}
	g, err := s.Store.GetGrant(r.Context(), id)
	if err != nil {
		storeError(w, "grant", err)
		return
	}
	if err := s.Store.DeleteGrant(r.Context(), id); err != nil {
		storeError(w, "grant", err)
		return
	}
	s.access.bump()
	s.audit(r, "grant.delete", "ok", &meta.Bucket{ID: g.BucketID, Name: g.BucketName}, g.Prefix, 0, grantDetail(g))
	w.WriteHeader(http.StatusNoContent)
}
