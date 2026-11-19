package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/luthfi9251/ku-storage/internal/cryptx"
	"github.com/luthfi9251/ku-storage/internal/meta"
)

type env struct {
	t     *testing.T
	srv   *httptest.Server
	store *meta.Store
	fs    *fakeStorage
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := meta.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	key := bytes.Repeat([]byte{1}, 32)
	cx, _ := cryptx.New(key)
	fs := newFakeStorage()
	h := NewServer(Deps{Store: st, Crypt: cx, Storage: fs, Options: Options{MaxUpload: 1 << 20}})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &env{t: t, srv: srv, store: st, fs: fs}
}

type client struct {
	e  *env
	hc *http.Client
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, hc: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// do sends a request with the same-origin header and decodes JSON into out.
func (c *client) do(method, path string, body any, out any) int {
	c.e.t.Helper()
	var rd io.Reader
	ct := ""
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
		ct = "text/plain"
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
		ct = "application/json"
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, rd)
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	req.Header.Set("Origin", c.e.srv.URL)
	res, err := c.hc.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		raw, _ := io.ReadAll(res.Body)
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, out); err != nil {
				c.e.t.Fatalf("%s %s: decode %q: %v", method, path, raw, err)
			}
		}
	}
	return res.StatusCode
}

func (c *client) mustDo(method, path string, body any, out any, want int) {
	c.e.t.Helper()
	var raw json.RawMessage
	got := c.do(method, path, body, &raw)
	if got != want {
		c.e.t.Fatalf("%s %s = %d want %d: %s", method, path, got, want, raw)
	}
	if out != nil && len(raw) > 0 {
		json.Unmarshal(raw, out)
	}
}

type idResp struct {
	ID string `json:"id"`
}

// setupWorld creates an admin, a user "alice" in group "team", a connection
// and bucket "assets". Returns admin client, alice client, bucket id, ids.
func setupWorld(t *testing.T) (e *env, admin, alice *client, bucket, aliceID, teamID string) {
	e = newEnv(t)
	admin = e.client()
	admin.mustDo("POST", "/api/auth/setup", map[string]string{"username": "Root", "password": "rootpassword1"}, nil, 201)

	var conn idResp
	admin.mustDo("POST", "/api/admin/connections", map[string]any{"name": "cf", "kind": "r2", "accountId": "abc123", "accessKey": "k", "secretKey": "s"}, &conn, 201)
	var b idResp
	admin.mustDo("POST", "/api/admin/buckets", map[string]any{"connectionId": conn.ID, "name": "assets"}, &b, 201)

	var team idResp
	admin.mustDo("POST", "/api/admin/groups", map[string]any{"name": "team", "memberIds": []string{}}, &team, 201)
	var created struct {
		User   idResp `json:"user"`
		Invite struct {
			InvitePath string `json:"invitePath"`
		} `json:"invite"`
	}
	admin.mustDo("POST", "/api/admin/users", map[string]any{"username": "alice", "displayName": "Alice", "role": "user", "groupIds": []string{team.ID}}, &created, 201)

	alice = e.client()
	// pending users cannot log in
	alice.mustDo("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "whatever123"}, nil, 401)
	token := strings.TrimPrefix(created.Invite.InvitePath, "/invite/")
	alice.mustDo("GET", "/api/invites/"+token, nil, nil, 200)
	alice.mustDo("POST", "/api/invites/"+token, map[string]string{"password": "alicepassword"}, nil, 200)
	alice.mustDo("POST", "/api/invites/"+token, map[string]string{"password": "alicepassword"}, nil, 404) // single use
	return e, admin, alice, b.ID, created.User.ID, team.ID
}

func grant(t *testing.T, admin *client, subjType, subjID, bucket, prefix string, perms map[string]bool) string {
	t.Helper()
	var g idResp
	admin.mustDo("POST", "/api/admin/grants", map[string]any{"subjectType": subjType, "subjectId": subjID, "bucketId": bucket, "prefix": prefix, "perms": perms}, &g, 201)
	return g.ID
}

var (
	viewer      = map[string]bool{"read": true}
	contributor = map[string]bool{"read": true, "create": true}
	manager     = map[string]bool{"read": true, "create": true, "update": true, "delete": true}
)

type browseResp struct {
	Virtual bool `json:"virtual"`
	Perms   struct {
		Read, Create, Update, Delete bool
	} `json:"perms"`
	Folders []struct {
		Prefix string `json:"prefix"`
	} `json:"folders"`
	Objects []struct {
		Key string `json:"key"`
	} `json:"objects"`
}

func q(s string) string { return strings.ReplaceAll(s, "/", "%2F") }

func TestCSRFOriginRequired(t *testing.T) {
	e := newEnv(t)
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/auth/setup", strings.NewReader(`{"username":"root","password":"rootpassword1"}`))
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != 403 {
		t.Fatalf("missing origin = %d", res.StatusCode)
	}
	req.Header.Set("Origin", "https://evil.example")
	req, _ = http.NewRequest("POST", e.srv.URL+"/api/auth/setup", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://evil.example")
	res, _ = http.DefaultClient.Do(req)
	if res.StatusCode != 403 {
		t.Fatalf("foreign origin = %d", res.StatusCode)
	}
}

func TestSetupOnlyOnce(t *testing.T) {
	e, _, _, _, _, _ := setupWorld(t)
	c := e.client()
	c.mustDo("POST", "/api/auth/setup", map[string]string{"username": "other", "password": "rootpassword1"}, nil, 409)
}

func TestNoGrantNoBucket(t *testing.T) {
	e, _, alice, bucket, _, _ := setupWorld(t)
	alice.mustDo("GET", "/api/browse?bucket="+bucket, nil, nil, 404)
	var me struct {
		Access []any `json:"access"`
	}
	alice.mustDo("GET", "/api/me", nil, &me, 200)
	if me.Access == nil || len(me.Access) != 0 {
		t.Fatalf("access = %#v", me.Access)
	}
	alice.mustDo("GET", "/api/admin/users", nil, nil, 403)
	_ = e
}

func TestPrefixIsolation(t *testing.T) {
	e, admin, alice, bucket, aliceID, _ := setupWorld(t)
	e.fs.put("assets", "clients/acme/a.txt", "a")
	e.fs.put("assets", "clients/acme-evil/x.txt", "x")
	e.fs.put("assets", "secret.txt", "s")
	grant(t, admin, "user", aliceID, bucket, "clients/acme", contributor)

	// root is virtual: only the path to the grant is visible
	var root browseResp
	alice.mustDo("GET", "/api/browse?bucket="+bucket, nil, &root, 200)
	if !root.Virtual || len(root.Folders) != 1 || root.Folders[0].Prefix != "clients/" || len(root.Objects) != 0 {
		t.Fatalf("root = %+v", root)
	}
	var clients browseResp
	alice.mustDo("GET", "/api/browse?bucket="+bucket+"&prefix=clients/", nil, &clients, 200)
	if len(clients.Folders) != 1 || clients.Folders[0].Prefix != "clients/acme/" {
		t.Fatalf("clients = %+v", clients)
	}
	var acme browseResp
	alice.mustDo("GET", "/api/browse?bucket="+bucket+"&prefix="+q("clients/acme/"), nil, &acme, 200)
	if acme.Virtual || len(acme.Objects) != 1 || !acme.Perms.Create || acme.Perms.Delete {
		t.Fatalf("acme = %+v", acme)
	}
	alice.mustDo("GET", "/api/browse?bucket="+bucket+"&prefix="+q("clients/acme-evil/"), nil, nil, 403)
	alice.mustDo("GET", "/api/objects/download?bucket="+bucket+"&key="+q("clients/acme-evil/x.txt"), nil, nil, 403)
	alice.mustDo("GET", "/api/objects/download?bucket="+bucket+"&key=secret.txt", nil, nil, 403)
	alice.mustDo("GET", "/api/objects/download?bucket="+bucket+"&key="+q("clients/acme/../acme-evil/x.txt"), nil, nil, 400)

	// download redirects to the presigned url
	code := alice.do("GET", "/api/objects/download?bucket="+bucket+"&key="+q("clients/acme/a.txt"), nil, nil)
	if code != 302 {
		t.Fatalf("download = %d", code)
	}

	// upload: create inside, refuse outside, refuse overwrite without update
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("clients/acme/new.txt"), "hello", nil, 201)
	if !e.fs.has("assets", "clients/acme/new.txt") {
		t.Fatal("upload not stored")
	}
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("clients/acme/new.txt"), "again", nil, 409)
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("clients/acme/new.txt")+"&overwrite=1", "again", nil, 403)
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("clients/acme-evil/new.txt"), "x", nil, 403)
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key=root.txt", "x", nil, 403)
	alice.mustDo("POST", "/api/objects/delete", map[string]any{"bucket": bucket, "keys": []string{"clients/acme/a.txt"}}, nil, 403)
	if !e.fs.has("assets", "clients/acme/a.txt") {
		t.Fatal("object deleted without permission")
	}

	// denied attempts are audited
	var audit struct {
		Items []struct{ Action, Result, Key string } `json:"items"`
	}
	admin.mustDo("GET", "/api/admin/audit?result=denied", nil, &audit, 200)
	if len(audit.Items) < 5 {
		t.Fatalf("denied audit entries = %+v", audit.Items)
	}
	admin.mustDo("GET", "/api/admin/audit?action=object.upload&result=ok", nil, &audit, 200)
	if len(audit.Items) != 1 || audit.Items[0].Key != "clients/acme/new.txt" {
		t.Fatalf("upload audit = %+v", audit.Items)
	}
}

func TestUpdateOnlyCannotCreate(t *testing.T) {
	e, admin, alice, bucket, aliceID, _ := setupWorld(t)
	e.fs.put("assets", "docs/a.txt", "a")
	grant(t, admin, "user", aliceID, bucket, "docs/", map[string]bool{"read": true, "update": true})
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("docs/a.txt")+"&overwrite=1", "new", nil, 201)
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("docs/b.txt")+"&overwrite=1", "new", nil, 409)
	alice.mustDo("PUT", "/api/objects?bucket="+bucket+"&key="+q("docs/b.txt"), "new", nil, 403)
	if e.fs.has("assets", "docs/b.txt") {
		t.Fatal("update-only user created an object")
	}
}

func TestGroupGrantAndRevocation(t *testing.T) {
	e, admin, alice, bucket, _, teamID := setupWorld(t)
	e.fs.put("assets", "shared/f/x.txt", "x")
	e.fs.put("assets", "shared/y.txt", "y")
	g := grant(t, admin, "group", teamID, bucket, "shared/", manager)

	var res browseResp
	alice.mustDo("GET", "/api/browse?bucket="+bucket+"&prefix=shared/", nil, &res, 200)
	if !res.Perms.Delete || len(res.Folders) != 1 || len(res.Objects) != 1 {
		t.Fatalf("shared = %+v", res)
	}
	alice.mustDo("POST", "/api/folders", map[string]any{"bucket": bucket, "prefix": "shared/", "name": "new"}, nil, 201)
	alice.mustDo("POST", "/api/folders", map[string]any{"bucket": bucket, "prefix": "shared/", "name": "new"}, nil, 409)
	alice.mustDo("POST", "/api/folders", map[string]any{"bucket": bucket, "prefix": "shared/", "name": "a/b"}, nil, 400)

	var del struct{ Deleted int }
	alice.mustDo("POST", "/api/objects/delete", map[string]any{"bucket": bucket, "keys": []string{"shared/f/", "shared/y.txt"}}, &del, 200)
	if del.Deleted != 2 || e.fs.has("assets", "shared/f/x.txt") || e.fs.has("assets", "shared/y.txt") {
		t.Fatalf("delete = %+v", del)
	}

	// revoke: effective immediately (cache is invalidated)
	admin.mustDo("DELETE", "/api/admin/grants/"+g, nil, nil, 204)
	alice.mustDo("GET", "/api/browse?bucket="+bucket+"&prefix=shared/", nil, nil, 404)
}

func TestFolderTooLarge(t *testing.T) {
	e, admin, alice, bucket, aliceID, _ := setupWorld(t)
	for i := 0; i < maxFolderObjs+1; i++ {
		e.fs.put("assets", "big/"+strings.Repeat("x", 1)+itoa(i), "")
	}
	e.fs.put("assets", "small.txt", "")
	grant(t, admin, "user", aliceID, bucket, "", manager)
	alice.mustDo("POST", "/api/objects/delete", map[string]any{"bucket": bucket, "keys": []string{"small.txt", "big/"}}, nil, 422)
	if !e.fs.has("assets", "small.txt") {
		t.Fatal("nothing may be deleted when one folder is too large")
	}
}

func TestDisableUserKillsSession(t *testing.T) {
	_, admin, alice, _, aliceID, teamID := setupWorld(t)
	alice.mustDo("GET", "/api/me", nil, nil, 200)
	admin.mustDo("PUT", "/api/admin/users/"+aliceID, map[string]any{"displayName": "Alice", "role": "user", "disabled": true, "groupIds": []string{teamID}}, nil, 200)
	alice.mustDo("GET", "/api/me", nil, nil, 401)
	alice.mustDo("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "alicepassword"}, nil, 401)
}

func TestLastAdminAndAdminOnly(t *testing.T) {
	e, admin, _, _, _, _ := setupWorld(t)
	var me struct {
		User struct{ ID string } `json:"user"`
	}
	admin.mustDo("GET", "/api/me", nil, &me, 200)
	admin.mustDo("PUT", "/api/admin/users/"+me.User.ID, map[string]any{"displayName": "", "role": "user", "disabled": false, "groupIds": []string{}}, nil, 409)
	admin.mustDo("DELETE", "/api/admin/users/"+me.User.ID, nil, nil, 409)
	_ = e
}

func TestLoginRateLimit(t *testing.T) {
	e, _, _, _, _, _ := setupWorld(t)
	c := e.client()
	for i := 0; i < 4; i++ { // setupWorld already recorded one failure
		c.mustDo("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "wrong-password"}, nil, 401)
	}
	c.mustDo("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "alicepassword"}, nil, 429)
}

func TestPasswordChangeRevokesOtherSessions(t *testing.T) {
	e, _, alice, _, _, _ := setupWorld(t)
	other := e.client()
	other.mustDo("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "alicepassword"}, nil, 200)
	alice.mustDo("PUT", "/api/me/password", map[string]string{"currentPassword": "alicepassword", "newPassword": "brandnewpass1"}, nil, 204)
	other.mustDo("GET", "/api/me", nil, nil, 401)
	alice.mustDo("GET", "/api/me", nil, nil, 200)
}

func TestGrantValidation(t *testing.T) {
	_, admin, _, bucket, aliceID, _ := setupWorld(t)
	bad := []map[string]any{
		{"subjectType": "user", "subjectId": aliceID, "bucketId": bucket, "prefix": "", "perms": map[string]bool{"create": true}},
		{"subjectType": "user", "subjectId": aliceID, "bucketId": bucket, "prefix": "../x", "perms": viewer},
		{"subjectType": "robot", "subjectId": aliceID, "bucketId": bucket, "prefix": "", "perms": viewer},
	}
	for _, b := range bad {
		admin.mustDo("POST", "/api/admin/grants", b, nil, 400)
	}
}

func TestBucketDeleteConfirm(t *testing.T) {
	e, admin, _, bucket, aliceID, _ := setupWorld(t)
	grant(t, admin, "user", aliceID, bucket, "", viewer)
	admin.mustDo("DELETE", "/api/admin/buckets/"+bucket, map[string]string{"confirmName": "nope"}, nil, 400)
	admin.mustDo("DELETE", "/api/admin/buckets/"+bucket, map[string]string{"confirmName": "assets"}, nil, 204)
	if gs, _ := e.store.ListGrants(context.Background(), meta.GrantFilter{}); len(gs) != 0 {
		t.Fatal("grants should be removed with the bucket")
	}
}
