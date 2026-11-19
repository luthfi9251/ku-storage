package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/luthfi9251/ku-storage/internal/meta"
	"github.com/luthfi9251/ku-storage/internal/s3x"
)

var (
	accountIDRe  = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)
	bucketNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
)

func (s *Server) connectionDTOs(r *http.Request) ([]connectionDTO, error) {
	conns, err := s.Store.ListConnections(r.Context())
	if err != nil {
		return nil, err
	}
	buckets, err := s.Store.ListBuckets(r.Context())
	if err != nil {
		return nil, err
	}
	out := []connectionDTO{}
	for _, c := range conns {
		d := connectionDTO{ID: encID(c.ID), Name: c.Name, Kind: c.Kind, AccountID: c.AccountID, Endpoint: c.Endpoint,
			Region: c.Region, PathStyle: c.PathStyle, AccessKey: c.AccessKey, HasSecret: c.SecretEnc != "",
			CreatedAt: ts(c.CreatedAt), Buckets: []bucketDTO{}}
		for i := range buckets {
			if buckets[i].ConnectionID == c.ID {
				d.Buckets = append(d.Buckets, toBucketDTO(&buckets[i]))
			}
		}
		out = append(out, d)
	}
	return out, nil
}

func (s *Server) writeConnection(w http.ResponseWriter, r *http.Request, id int64, status int) {
	cs, err := s.connectionDTOs(r)
	if err != nil {
		internalError(w, "connections", err)
		return
	}
	for _, c := range cs {
		if c.ID == encID(id) {
			jsonOut(w, status, c)
			return
		}
	}
	fail(w, http.StatusNotFound, "NOT_FOUND", "connection not found")
}

func (s *Server) handleListConnections(w http.ResponseWriter, r *http.Request) {
	cs, err := s.connectionDTOs(r)
	if err != nil {
		internalError(w, "connections", err)
		return
	}
	jsonOut(w, http.StatusOK, cs)
}

type connectionRequest struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	AccountID string `json:"accountId"`
	Endpoint  string `json:"endpoint"`
	Region    string `json:"region"`
	PathStyle bool   `json:"pathStyle"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
}

func (s *Server) decodeConnection(w http.ResponseWriter, r *http.Request, creating bool) (*meta.Connection, bool) {
	var req connectionRequest
	if !decodeBody(w, r, &req) {
		return nil, false
	}
	c := &meta.Connection{Name: strings.TrimSpace(req.Name), Kind: req.Kind, AccessKey: strings.TrimSpace(req.AccessKey)}
	bad := func(msg string) (*meta.Connection, bool) {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", msg)
		return nil, false
	}
	if c.Name == "" || len(c.Name) > 100 {
		return bad("name is required (max 100 chars)")
	}
	switch c.Kind {
	case "r2":
		c.AccountID = strings.TrimSpace(req.AccountID)
		if !accountIDRe.MatchString(c.AccountID) {
			return bad("a valid Cloudflare account ID is required")
		}
		c.Region = "auto"
	case "s3":
		c.Endpoint = strings.TrimRight(strings.TrimSpace(req.Endpoint), "/")
		u, err := url.Parse(c.Endpoint)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || (u.Path != "" && u.Path != "/") {
			return bad("endpoint must be like https://host[:port]")
		}
		c.Region, c.PathStyle = strings.TrimSpace(req.Region), req.PathStyle
	default:
		return bad("kind must be r2 or s3")
	}
	if c.AccessKey == "" {
		return bad("access key is required")
	}
	if req.SecretKey == "" && creating {
		return bad("secret key is required")
	}
	if req.SecretKey != "" {
		enc, err := s.Crypt.Encrypt(req.SecretKey)
		if err != nil {
			internalError(w, "encrypt", err)
			return nil, false
		}
		c.SecretEnc = enc
	}
	return c, true
}

func (s *Server) handleCreateConnection(w http.ResponseWriter, r *http.Request) {
	c, ok := s.decodeConnection(w, r, true)
	if !ok {
		return
	}
	id, err := s.Store.CreateConnection(r.Context(), *c)
	if err != nil {
		storeError(w, "connection", err)
		return
	}
	s.audit(r, "connection.create", "ok", nil, "", 0, c.Name)
	s.writeConnection(w, r, id, http.StatusCreated)
}

func (s *Server) handleUpdateConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "connection")
	if !ok {
		return
	}
	c, ok := s.decodeConnection(w, r, false)
	if !ok {
		return
	}
	c.ID = id
	if err := s.Store.UpdateConnection(r.Context(), *c); err != nil {
		storeError(w, "connection", err)
		return
	}
	s.Storage.Invalidate(id)
	s.audit(r, "connection.update", "ok", nil, "", 0, c.Name)
	s.writeConnection(w, r, id, http.StatusOK)
}

func (s *Server) handleDeleteConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "connection")
	if !ok {
		return
	}
	c, err := s.Store.GetConnection(r.Context(), id)
	if err != nil {
		storeError(w, "connection", err)
		return
	}
	if err := s.Store.DeleteConnection(r.Context(), id); err != nil {
		if errors.Is(err, meta.ErrConflict) {
			fail(w, http.StatusConflict, "CONFLICT", "remove the buckets of this connection first")
			return
		}
		storeError(w, "connection", err)
		return
	}
	s.Storage.Invalidate(id)
	s.audit(r, "connection.delete", "ok", nil, "", 0, c.Name)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDiscover(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "connection")
	if !ok {
		return
	}
	if _, err := s.Store.GetConnection(r.Context(), id); err != nil {
		storeError(w, "connection", err)
		return
	}
	c, err := s.Storage.Get(r.Context(), id)
	if err != nil {
		storageError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	names, err := c.ListBuckets(ctx)
	if err != nil {
		storageError(w, err)
		return
	}
	if names == nil {
		names = []string{}
	}
	jsonOut(w, http.StatusOK, map[string]any{"buckets": names})
}

func (s *Server) handleListBuckets(w http.ResponseWriter, r *http.Request) {
	bs, err := s.Store.ListBuckets(r.Context())
	if err != nil {
		internalError(w, "buckets", err)
		return
	}
	out := []bucketDTO{}
	for i := range bs {
		out = append(out, toBucketDTO(&bs[i]))
	}
	jsonOut(w, http.StatusOK, out)
}

func (s *Server) handleCreateBucket(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectionID string `json:"connectionId"`
		Name         string `json:"name"`
		DisplayName  string `json:"displayName"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	cid, err := decID(req.ConnectionID)
	if err != nil {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid connection")
		return
	}
	if _, err := s.Store.GetConnection(r.Context(), cid); err != nil {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "connection not found")
		return
	}
	name := strings.TrimSpace(req.Name)
	if !bucketNameRe.MatchString(name) {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", "invalid bucket name")
		return
	}
	id, err := s.Store.CreateBucket(r.Context(), cid, name, strings.TrimSpace(req.DisplayName))
	if err != nil {
		storeError(w, "bucket", err)
		return
	}
	s.access.bump()
	b, err := s.Store.GetBucket(r.Context(), id)
	if err != nil {
		internalError(w, "get bucket", err)
		return
	}
	s.audit(r, "bucket.register", "ok", b, "", 0, "")
	jsonOut(w, http.StatusCreated, toBucketDTO(b))
}

func (s *Server) handleUpdateBucket(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "bucket")
	if !ok {
		return
	}
	var req struct {
		DisplayName string `json:"displayName"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if err := s.Store.UpdateBucket(r.Context(), id, strings.TrimSpace(req.DisplayName)); err != nil {
		storeError(w, "bucket", err)
		return
	}
	b, err := s.Store.GetBucket(r.Context(), id)
	if err != nil {
		storeError(w, "bucket", err)
		return
	}
	s.audit(r, "bucket.update", "ok", b, "", 0, "display name: "+b.DisplayName)
	jsonOut(w, http.StatusOK, toBucketDTO(b))
}

func (s *Server) handleDeleteBucket(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "bucket")
	if !ok {
		return
	}
	var req struct {
		ConfirmName string `json:"confirmName"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	b, err := s.Store.GetBucket(r.Context(), id)
	if err != nil {
		storeError(w, "bucket", err)
		return
	}
	if req.ConfirmName != b.Name {
		fail(w, http.StatusBadRequest, "CONFIRM_MISMATCH", "type the bucket name to confirm")
		return
	}
	if err := s.Store.DeleteBucket(r.Context(), id); err != nil {
		storeError(w, "bucket", err)
		return
	}
	s.access.bump()
	s.audit(r, "bucket.unregister", "ok", b, "", 0, "grants removed: "+itoa(b.GrantCount))
	w.WriteHeader(http.StatusNoContent)
}

type testStep struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

func (s *Server) handleTestBucket(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "bucket")
	if !ok {
		return
	}
	var req struct {
		Write bool `json:"write"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	b, err := s.Store.GetBucket(r.Context(), id)
	if err != nil {
		storeError(w, "bucket", err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	steps := []testStep{}
	allOK := true
	step := func(name string, fn func() error) bool {
		err := fn()
		st := testStep{Name: name, OK: err == nil, Message: "ok"}
		if err != nil {
			st.Message = s3x.Message(err)
			allOK = false
		}
		steps = append(steps, st)
		return err == nil
	}
	var c s3x.Client
	if step("connect", func() error { var e error; c, e = s.Storage.Get(ctx, b.ConnectionID); return e }) &&
		step("head bucket", func() error { return c.HeadBucket(ctx, b.Name) }) &&
		step("list objects", func() error { _, e := c.List(ctx, b.Name, "", "", 1); return e }) && req.Write {
		raw := make([]byte, 8)
		_, _ = rand.Read(raw)
		key := ".ku-storage-probe-" + hex.EncodeToString(raw)
		if step("write probe object", func() error {
			_, e := c.Put(ctx, b.Name, key, strings.NewReader("ku-storage probe"), 16, "text/plain", s3x.CondAbsent)
			return e
		}) {
			step("delete probe object", func() error {
				errs, e := c.Remove(ctx, b.Name, []string{key})
				if e == nil && len(errs) > 0 {
					e = errors.New(errs[0].Message)
				}
				return e
			})
		}
	}
	jsonOut(w, http.StatusOK, map[string]any{"ok": allOK, "steps": steps})
}
