package api

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/luthfi9251/ku-storage/internal/authz"
	"github.com/luthfi9251/ku-storage/internal/meta"
	"github.com/luthfi9251/ku-storage/internal/s3x"
)

// objectCtx resolves the bucket and storage client of a request and the
// caller's access. Writes the error response and returns ok=false on failure.
type objectCtx struct {
	bucket *meta.Bucket
	client s3x.Client
	access *access
}

func (s *Server) objectContext(w http.ResponseWriter, r *http.Request, bucketID string) (*objectCtx, bool) {
	id, err := decID(bucketID)
	if err != nil {
		fail(w, http.StatusNotFound, "NOT_FOUND", "bucket not found")
		return nil, false
	}
	a, err := s.accessFor(r.Context(), current(r).user)
	if err != nil {
		internalError(w, "access", err)
		return nil, false
	}
	b, err := s.Store.GetBucket(r.Context(), id)
	if err != nil {
		if errors.Is(err, meta.ErrNotFound) {
			fail(w, http.StatusNotFound, "NOT_FOUND", "bucket not found")
		} else {
			internalError(w, "get bucket", err)
		}
		return nil, false
	}
	// Users without any access to the bucket get the same answer as for a
	// missing bucket, so bucket ids cannot be probed.
	if !a.canSee(b.ID, "") {
		fail(w, http.StatusNotFound, "NOT_FOUND", "bucket not found")
		return nil, false
	}
	c, err := s.Storage.Get(r.Context(), b.ConnectionID)
	if err != nil {
		storageError(w, err)
		return nil, false
	}
	return &objectCtx{bucket: b, client: c, access: a}, true
}

func storageError(w http.ResponseWriter, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	internalLog("storage", err)
	fail(w, http.StatusBadGateway, "STORAGE_ERROR", s3x.Message(err))
}

func (s *Server) deny(w http.ResponseWriter, r *http.Request, action string, b *meta.Bucket, key string) {
	s.audit(r, action, "denied", b, key, 0, "")
	fail(w, http.StatusForbidden, "FORBIDDEN", "you do not have permission for this action")
}

func validKey(w http.ResponseWriter, key string) bool {
	if authz.ValidateKey(key) != nil {
		fail(w, http.StatusBadRequest, "INVALID_KEY", "invalid object key")
		return false
	}
	return true
}

type browseFolder struct {
	Name   string   `json:"name"`
	Prefix string   `json:"prefix"`
	Perms  permsDTO `json:"perms"`
}

type browseObject struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	LastModified string `json:"lastModified"`
	ETag         string `json:"etag"`
}

func childName(prefix, full string) string {
	return strings.TrimSuffix(strings.TrimPrefix(full, prefix), "/")
}

func (s *Server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	oc, ok := s.objectContext(w, r, q.Get("bucket"))
	if !ok {
		return
	}
	prefix, err := authz.NormalizePrefix(q.Get("prefix"))
	if err != nil {
		fail(w, http.StatusBadRequest, "INVALID_KEY", "invalid prefix")
		return
	}
	cursor := q.Get("cursor")
	b := oc.bucket
	p := oc.access.perms(b.ID, prefix)
	res := map[string]any{
		"bucket":     map[string]string{"id": encID(b.ID), "name": b.Name, "displayName": b.Label()},
		"prefix":     prefix,
		"perms":      toPermsDTO(p),
		"nextCursor": nil,
	}
	folders := []browseFolder{}
	objects := []browseObject{}
	addFolder := func(full string) {
		folders = append(folders, browseFolder{Name: childName(prefix, full), Prefix: full, Perms: toPermsDTO(oc.access.perms(b.ID, full))})
	}

	if !p.Has(authz.Read) {
		children := authz.VirtualChildren(oc.access.grants, b.ID, prefix)
		if len(children) == 0 {
			s.deny(w, r, "browse.denied", b, prefix)
			return
		}
		for _, c := range children {
			addFolder(c)
		}
		res["virtual"], res["folders"], res["objects"] = true, folders, objects
		jsonOut(w, http.StatusOK, res)
		return
	}

	l, err := oc.client.List(r.Context(), b.Name, prefix, cursor, pageSize)
	if err != nil {
		storageError(w, err)
		return
	}
	seen := map[string]bool{}
	for _, f := range l.Folders {
		seen[f] = true
		addFolder(f)
	}
	// Granted folders that hold no object yet do not show up in a listing;
	// add them on the first page so users can reach them.
	if cursor == "" && !oc.access.admin {
		for _, c := range authz.VirtualChildren(oc.access.grants, b.ID, prefix) {
			if !seen[c] {
				addFolder(c)
			}
		}
		sort.Slice(folders, func(i, j int) bool { return folders[i].Prefix < folders[j].Prefix })
	}
	for _, o := range l.Objects {
		if o.Key == prefix {
			continue
		}
		objects = append(objects, browseObject{Key: o.Key, Name: path.Base(o.Key), Size: o.Size, LastModified: ts(o.LastModified), ETag: o.ETag})
	}
	if l.NextCursor != "" {
		res["nextCursor"] = l.NextCursor
	}
	res["virtual"], res["folders"], res["objects"] = false, folders, objects
	jsonOut(w, http.StatusOK, res)
}

func (s *Server) handleStat(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	oc, ok := s.objectContext(w, r, q.Get("bucket"))
	if !ok {
		return
	}
	key := q.Get("key")
	if !validKey(w, key) {
		return
	}
	if !oc.access.perms(oc.bucket.ID, key).Has(authz.Read) {
		s.deny(w, r, "object.stat", oc.bucket, key)
		return
	}
	o, err := oc.client.Stat(r.Context(), oc.bucket.Name, key)
	if errors.Is(err, s3x.ErrNotFound) {
		fail(w, http.StatusNotFound, "NOT_FOUND", "object not found")
		return
	}
	if err != nil {
		storageError(w, err)
		return
	}
	md := o.Metadata
	if md == nil {
		md = map[string]string{}
	}
	jsonOut(w, http.StatusOK, map[string]any{"key": o.Key, "size": o.Size, "lastModified": ts(o.LastModified),
		"etag": o.ETag, "contentType": o.ContentType, "metadata": md})
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	oc, ok := s.objectContext(w, r, q.Get("bucket"))
	if !ok {
		return
	}
	key := q.Get("key")
	if !validKey(w, key) {
		return
	}
	inline := q.Get("inline") == "1"
	action := "object.download"
	if inline {
		action = "object.preview"
	}
	if strings.HasSuffix(key, "/") {
		fail(w, http.StatusBadRequest, "INVALID_KEY", "folders cannot be downloaded")
		return
	}
	if !oc.access.perms(oc.bucket.ID, key).Has(authz.Read) {
		s.deny(w, r, action, oc.bucket, key)
		return
	}
	o, err := oc.client.Stat(r.Context(), oc.bucket.Name, key)
	if errors.Is(err, s3x.ErrNotFound) {
		fail(w, http.StatusNotFound, "NOT_FOUND", "object not found")
		return
	}
	if err != nil {
		storageError(w, err)
		return
	}
	u, err := oc.client.PresignGet(r.Context(), oc.bucket.Name, key, s.Options.PresignTTL, inline)
	if err != nil {
		storageError(w, err)
		return
	}
	s.audit(r, action, "ok", oc.bucket, key, o.Size, "")
	http.Redirect(w, r, u, http.StatusFound)
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	oc, ok := s.objectContext(w, r, q.Get("bucket"))
	if !ok {
		return
	}
	key := q.Get("key")
	if !validKey(w, key) {
		return
	}
	if strings.HasSuffix(key, "/") {
		fail(w, http.StatusBadRequest, "INVALID_KEY", "use the folders endpoint to create folders")
		return
	}
	overwrite := q.Get("overwrite") == "1"
	action := "object.upload"
	if overwrite {
		action = "object.overwrite"
	}
	p := oc.access.perms(oc.bucket.ID, key)
	var cond s3x.Cond
	switch {
	case !overwrite && p.Has(authz.Create):
		cond = s3x.CondAbsent
	case overwrite && p.Has(authz.Update|authz.Create):
		cond = s3x.CondNone
	case overwrite && p.Has(authz.Update):
		cond = s3x.CondPresent
	default:
		s.deny(w, r, action, oc.bucket, key)
		return
	}
	if r.ContentLength < 0 {
		fail(w, http.StatusLengthRequired, "LENGTH_REQUIRED", "Content-Length is required")
		return
	}
	if r.ContentLength > s.Options.MaxUpload {
		fail(w, http.StatusRequestEntityTooLarge, "TOO_LARGE", fmt.Sprintf("file exceeds the %d byte limit", s.Options.MaxUpload))
		return
	}
	ct := r.Header.Get("Content-Type")
	if ct == "" || ct == "application/octet-stream" {
		if guess := mime.TypeByExtension(path.Ext(key)); guess != "" {
			ct = guess
		}
	}
	if ct == "" {
		ct = "application/octet-stream"
	}
	body := http.MaxBytesReader(w, r.Body, r.ContentLength)
	o, err := oc.client.Put(r.Context(), oc.bucket.Name, key, body, r.ContentLength, ct, cond)
	switch {
	case errors.Is(err, s3x.ErrExists):
		fail(w, http.StatusConflict, "OBJECT_EXISTS", "an object with this name already exists")
		return
	case errors.Is(err, s3x.ErrNotFound):
		fail(w, http.StatusConflict, "OBJECT_MISSING", "object does not exist and you may not create new objects")
		return
	case errors.Is(err, s3x.ErrChanged):
		fail(w, http.StatusConflict, "CONFLICT", "object changed while uploading, try again")
		return
	case err != nil:
		if r.Context().Err() == nil {
			s.audit(r, action, "error", oc.bucket, key, r.ContentLength, s3x.Message(err))
		}
		storageError(w, err)
		return
	}
	s.audit(r, action, "ok", oc.bucket, key, o.Size, "")
	jsonOut(w, http.StatusCreated, map[string]any{"key": key, "size": o.Size, "etag": o.ETag})
}

func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Bucket string `json:"bucket"`
		Prefix string `json:"prefix"`
		Name   string `json:"name"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	oc, ok := s.objectContext(w, r, req.Bucket)
	if !ok {
		return
	}
	prefix, err := authz.NormalizePrefix(req.Prefix)
	if err != nil || authz.ValidateName(strings.TrimSpace(req.Name)) != nil {
		fail(w, http.StatusBadRequest, "INVALID_KEY", "invalid folder name")
		return
	}
	key := prefix + strings.TrimSpace(req.Name) + "/"
	if !validKey(w, key) {
		return
	}
	if !oc.access.perms(oc.bucket.ID, key).Has(authz.Create) {
		s.deny(w, r, "folder.create", oc.bucket, key)
		return
	}
	_, err = oc.client.Put(r.Context(), oc.bucket.Name, key, strings.NewReader(""), 0, "application/x-directory", s3x.CondAbsent)
	if errors.Is(err, s3x.ErrExists) {
		fail(w, http.StatusConflict, "OBJECT_EXISTS", "folder already exists")
		return
	}
	if err != nil {
		storageError(w, err)
		return
	}
	s.audit(r, "folder.create", "ok", oc.bucket, key, 0, "")
	jsonOut(w, http.StatusCreated, map[string]string{"prefix": key})
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Bucket string   `json:"bucket"`
		Keys   []string `json:"keys"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if len(req.Keys) == 0 || len(req.Keys) > maxDeleteKeys {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", fmt.Sprintf("keys must contain 1-%d entries", maxDeleteKeys))
		return
	}
	oc, ok := s.objectContext(w, r, req.Bucket)
	if !ok {
		return
	}
	b := oc.bucket
	// 1. validate and authorise everything before touching storage.
	var denied []string
	for _, k := range req.Keys {
		if !validKey(w, k) {
			return
		}
		if !oc.access.perms(b.ID, k).Has(authz.Delete) {
			denied = append(denied, k)
		}
	}
	if len(denied) > 0 {
		s.audit(r, "object.delete", "denied", b, denied[0], 0, strings.Join(denied, "\n"))
		fail(w, http.StatusForbidden, "FORBIDDEN", "you do not have permission to delete: "+strings.Join(denied, ", "))
		return
	}
	// 2. expand folders (permissions are monotonic, so delete on the folder
	// covers everything inside it). Refuse oversized folders up front.
	type group struct {
		key  string
		keys []string
	}
	var groups []group
	seen := map[string]bool{}
	for _, k := range req.Keys {
		g := group{key: k}
		if strings.HasSuffix(k, "/") {
			keys, err := oc.client.ListAll(r.Context(), b.Name, k, maxFolderObjs)
			if errors.Is(err, s3x.ErrTooMany) {
				fail(w, http.StatusUnprocessableEntity, "FOLDER_TOO_LARGE",
					fmt.Sprintf("folder %s holds more than %d objects", k, maxFolderObjs))
				return
			}
			if err != nil {
				storageError(w, err)
				return
			}
			g.keys = keys
		} else {
			g.keys = []string{k}
		}
		for _, x := range g.keys {
			if !seen[x] {
				seen[x] = true
			}
		}
		groups = append(groups, g)
	}
	all := make([]string, 0, len(seen))
	for k := range seen {
		all = append(all, k)
	}
	sort.Strings(all)
	// 3. delete. Use a context detached from the client so an aborted request
	// does not leave the audit log out of sync with storage.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Minute)
	defer cancel()
	var errs []s3x.RemoveError
	if len(all) > 0 {
		var err error
		errs, err = oc.client.Remove(ctx, b.Name, all)
		if err != nil {
			storageError(w, err)
			return
		}
	}
	failed := map[string]string{}
	for _, e := range errs {
		failed[e.Key] = e.Message
	}
	for _, g := range groups {
		result := "ok"
		var bad []string
		for _, k := range g.keys {
			if _, f := failed[k]; f {
				bad = append(bad, k)
			}
		}
		if len(bad) > 0 {
			result = "error"
		}
		if strings.HasSuffix(g.key, "/") {
			detail := fmt.Sprintf("%d objects", len(g.keys))
			if len(bad) > 0 {
				detail += fmt.Sprintf(", %d failed", len(bad))
			}
			s.audit(r, "folder.delete", result, b, g.key, 0, detail+"\n"+strings.Join(g.keys, "\n"))
		} else {
			s.audit(r, "object.delete", result, b, g.key, 0, failed[g.key])
		}
	}
	outErrs := []map[string]string{}
	for _, e := range errs {
		outErrs = append(outErrs, map[string]string{"key": e.Key, "message": e.Message})
	}
	jsonOut(w, http.StatusOK, map[string]any{"deleted": len(all) - len(errs), "errors": outErrs})
}
