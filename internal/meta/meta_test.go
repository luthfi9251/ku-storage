package meta

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func mustUser(t *testing.T, s *Store, name, role, hash string) int64 {
	t.Helper()
	id, err := s.CreateUser(context.Background(), User{Username: name, Role: role, PasswordHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestUsernameUnique(t *testing.T) {
	s := newStore(t)
	mustUser(t, s, "a", "user", "h")
	if _, err := s.CreateUser(context.Background(), User{Username: "a", Role: "user"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("got %v want ErrConflict", err)
	}
}

func TestLastAdminProtection(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	a := mustUser(t, s, "admin", "admin", "h")
	pending := mustUser(t, s, "pend", "admin", "") // pending admin does not count
	if err := s.UpdateUser(ctx, a, "", "user", false, nil); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("demote: %v", err)
	}
	if err := s.UpdateUser(ctx, a, "", "admin", true, nil); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("disable: %v", err)
	}
	if err := s.DeleteUser(ctx, a); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("delete: %v", err)
	}
	if err := s.DeleteUser(ctx, pending); err != nil {
		t.Fatalf("delete pending admin: %v", err)
	}
	b := mustUser(t, s, "admin2", "admin", "h")
	if err := s.UpdateUser(ctx, a, "", "user", false, nil); err != nil {
		t.Fatalf("demote with second admin: %v", err)
	}
	if err := s.DeleteUser(ctx, b); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("delete last: %v", err)
	}
}

func TestSessions(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	now := time.Unix(1_800_000_000, 0)
	s.SetClock(func() time.Time { return now })
	u := mustUser(t, s, "u", "user", "h")
	sid, err := s.CreateSession(ctx, "hash1", u, "1.1.1.1", "ua", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.LookupSession(ctx, "hash1"); err != nil {
		t.Fatal(err)
	}
	// sliding but capped by max age
	now = now.Add(50 * time.Minute)
	if err := s.TouchSession(ctx, sid, "2.2.2.2", time.Hour, 90*time.Minute); err != nil {
		t.Fatal(err)
	}
	now = now.Add(35 * time.Minute) // 85m after creation: alive
	if _, _, err := s.LookupSession(ctx, "hash1"); err != nil {
		t.Fatalf("should be alive: %v", err)
	}
	now = now.Add(6 * time.Minute) // 91m: past max age
	if _, _, err := s.LookupSession(ctx, "hash1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("should be expired: %v", err)
	}
	// disabled user cannot use a session
	s.CreateSession(ctx, "hash2", u, "", "", time.Hour)
	mustUser(t, s, "adm", "admin", "h")
	if err := s.UpdateUser(ctx, u, "", "user", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.LookupSession(ctx, "hash2"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("disabled user session: %v", err)
	}
}

func TestInviteSingleUse(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	u := mustUser(t, s, "u", "user", "")
	s.CreateSession(ctx, "sess", u, "", "", time.Hour)
	if _, err := s.CreateInvite(ctx, "old", u, "invite", time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateInvite(ctx, "tok", u, "invite", time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetInvite(ctx, "old"); !errors.Is(err, ErrNotFound) {
		t.Fatal("older invite should be invalidated")
	}
	inv, err := s.GetInvite(ctx, "tok")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UseInvite(ctx, inv.ID, u, "newhash"); err != nil {
		t.Fatal(err)
	}
	if err := s.UseInvite(ctx, inv.ID, u, "again"); !errors.Is(err, ErrNotFound) {
		t.Fatal("second use must fail")
	}
	got, _ := s.GetUser(ctx, u)
	if got.PasswordHash != "newhash" {
		t.Fatal("password not set")
	}
	if ss, _ := s.ListSessions(ctx, u); len(ss) != 0 {
		t.Fatal("sessions should be dropped")
	}
}

func TestGrantsAndCascades(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	u := mustUser(t, s, "u", "user", "h")
	other := mustUser(t, s, "o", "user", "h")
	g, err := s.CreateGroup(ctx, "Team", []int64{u})
	if err != nil {
		t.Fatal(err)
	}
	c, _ := s.CreateConnection(ctx, Connection{Name: "r2", Kind: "r2", AccountID: "x", AccessKey: "k", SecretEnc: "e"})
	b, _ := s.CreateBucket(ctx, c, "assets", "")
	b2, _ := s.CreateBucket(ctx, c, "logs", "")

	id1, _ := s.UpsertGrant(ctx, Grant{SubjectType: "user", SubjectID: u, BucketID: b, Prefix: "a/", Perms: 1}, 0)
	id2, _ := s.UpsertGrant(ctx, Grant{SubjectType: "user", SubjectID: u, BucketID: b, Prefix: "a/", Perms: 3}, 0)
	if id1 != id2 {
		t.Fatal("upsert should keep id")
	}
	s.UpsertGrant(ctx, Grant{SubjectType: "group", SubjectID: g, BucketID: b2, Prefix: "", Perms: 1}, 0)
	s.UpsertGrant(ctx, Grant{SubjectType: "user", SubjectID: other, BucketID: b, Prefix: "", Perms: 15}, 0)

	gs, _ := s.UserGrants(ctx, u)
	if len(gs) != 2 || gs[0].Perms != 3 || gs[1].SubjectName != "Team" {
		t.Fatalf("UserGrants = %+v", gs)
	}
	if err := s.DeleteConnection(ctx, c); !errors.Is(err, ErrConflict) {
		t.Fatal("connection with buckets must not be deletable")
	}
	if err := s.DeleteGroup(ctx, g); err != nil {
		t.Fatal(err)
	}
	if gs, _ := s.UserGrants(ctx, u); len(gs) != 1 {
		t.Fatalf("group grants should cascade: %+v", gs)
	}
	if err := s.DeleteBucket(ctx, b); err != nil {
		t.Fatal(err)
	}
	if all, _ := s.ListGrants(ctx, GrantFilter{}); len(all) != 0 {
		t.Fatalf("bucket grants should cascade: %+v", all)
	}
}

func TestAuditFilter(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	base := time.Unix(1_800_000_000, 0)
	for i, a := range []string{"login", "object.upload", "object.delete", "object.upload"} {
		s.InsertAudit(ctx, AuditEntry{TS: base.Add(time.Duration(i) * time.Hour), UserID: int64(i%2 + 1), Action: a, Result: "ok"})
	}
	all, _ := s.ListAudit(ctx, AuditFilter{})
	if len(all) != 4 || all[0].Action != "object.upload" || all[0].ID != 4 {
		t.Fatalf("order: %+v", all)
	}
	obj, _ := s.ListAudit(ctx, AuditFilter{Action: "object."})
	if len(obj) != 3 {
		t.Fatalf("action prefix: %d", len(obj))
	}
	page, _ := s.ListAudit(ctx, AuditFilter{Before: 3, Limit: 1})
	if len(page) != 1 || page[0].ID != 2 {
		t.Fatalf("paging: %+v", page)
	}
	rng, _ := s.ListAudit(ctx, AuditFilter{From: base.Add(time.Hour), To: base.Add(3 * time.Hour)})
	if len(rng) != 2 {
		t.Fatalf("range: %d", len(rng))
	}
	if n, _ := s.PurgeAudit(ctx, base.Add(2*time.Hour)); n != 2 {
		t.Fatalf("purge: %d", n)
	}
}
