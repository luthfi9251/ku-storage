package authz

import (
	"reflect"
	"strings"
	"testing"
)

func TestValidateKey(t *testing.T) {
	ok := []string{"a", "a/b.txt", "folder/", "a/b/c/", "spasi nama.pdf", "ümlaut/日本.png", "a..b", ".hidden", "a/.b/c"}
	bad := []string{"", "/a", "a//b", "a/../b", "..", "../a", "a/..", "a/./b", ".", "a\\b", "a\x00b", "a\nb", "a\x7fb", "\xff", strings.Repeat("x", 1025)}
	for _, k := range ok {
		if err := ValidateKey(k); err != nil {
			t.Errorf("ValidateKey(%q) = %v, want ok", k, err)
		}
	}
	for _, k := range bad {
		if err := ValidateKey(k); err == nil {
			t.Errorf("ValidateKey(%q) = ok, want error", k)
		}
	}
}

func TestValidateName(t *testing.T) {
	if ValidateName("a/b") == nil || ValidateName("") == nil || ValidateName("..") == nil {
		t.Fatal("expected errors")
	}
	if ValidateName("laporan 2026.xlsx") != nil {
		t.Fatal("expected ok")
	}
}

func TestNormalizePrefix(t *testing.T) {
	cases := map[string]string{"": "", "a": "a/", "a/": "a/", "a/b": "a/b/"}
	for in, want := range cases {
		got, err := NormalizePrefix(in)
		if err != nil || got != want {
			t.Errorf("NormalizePrefix(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"/a", "a//", "../", "a/../b"} {
		if _, err := NormalizePrefix(in); err == nil {
			t.Errorf("NormalizePrefix(%q) want error", in)
		}
	}
}

func TestPermValid(t *testing.T) {
	if !Read.Valid() || !All.Valid() || (Read|Create).Valid() == false {
		t.Fatal("valid perms rejected")
	}
	if None.Valid() || Create.Valid() || (Delete | Update).Valid() || Perm(1<<5).Valid() {
		t.Fatal("invalid perms accepted")
	}
}

func TestEffective(t *testing.T) {
	g := []Grant{
		{BucketID: 1, Prefix: "clients/acme/", Perms: Read},
		{BucketID: 1, Prefix: "clients/acme/uploads/", Perms: Read | Create},
		{BucketID: 1, Prefix: "clients/acme/uploads/", Perms: Read | Delete}, // via group
		{BucketID: 2, Prefix: "", Perms: All},
	}
	cases := []struct {
		bucket int64
		key    string
		want   Perm
	}{
		{1, "clients/acme/a.txt", Read},
		{1, "clients/acme/", Read},
		{1, "clients/acme", None},            // the folder name without slash is outside
		{1, "clients/acme-evil/a.txt", None}, // boundary
		{1, "clients/acme/uploads/x.png", Read | Create | Delete},
		{1, "clients/acme/uploadsX/x.png", Read},
		{1, "clients/", None},
		{1, "other.txt", None},
		{2, "anything/at/all", All},
		{3, "x", None},
	}
	for _, c := range cases {
		if got := Effective(g, c.bucket, c.key); got != c.want {
			t.Errorf("Effective(%d,%q) = %b want %b", c.bucket, c.key, got, c.want)
		}
	}
}

func TestVirtualChildren(t *testing.T) {
	g := []Grant{
		{BucketID: 1, Prefix: "clients/acme/reports/", Perms: Read},
		{BucketID: 1, Prefix: "clients/beta/", Perms: Read | Create},
		{BucketID: 1, Prefix: "public/", Perms: Read},
		{BucketID: 2, Prefix: "zzz/", Perms: Read},
	}
	cases := map[string][]string{
		"":                      {"clients/", "public/"},
		"clients/":              {"clients/acme/", "clients/beta/"},
		"clients/acme/":         {"clients/acme/reports/"},
		"clients/acme/reports/": {},
		"clients/beta/":         {},
		"nope/":                 {},
		"clients/ac":            {}, // not a real prefix
	}
	for p, want := range cases {
		got := VirtualChildren(g, 1, p)
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("VirtualChildren(%q) = %v want %v", p, got, want)
		}
	}
	if !CanSee(g, 1, "") || !CanSee(g, 1, "clients/acme/") || !CanSee(g, 1, "clients/beta/sub/") {
		t.Error("CanSee false negative")
	}
	if CanSee(g, 1, "secret/") || CanSee(g, 1, "clients/gamma/") || CanSee(g, 3, "") {
		t.Error("CanSee false positive")
	}
}

func TestVirtualIgnoresWriteOnly(t *testing.T) {
	g := []Grant{{BucketID: 1, Prefix: "a/b/", Perms: Create}}
	if len(VirtualChildren(g, 1, "")) != 0 {
		t.Fatal("write-only grant should not be navigable")
	}
}

func TestEntryPoints(t *testing.T) {
	g := []Grant{
		{BucketID: 1, Prefix: "a/", Perms: Read},
		{BucketID: 1, Prefix: "a/b/", Perms: Read | Create}, // inside a/
		{BucketID: 1, Prefix: "a/", Perms: Read | Delete},   // duplicate via group
		{BucketID: 1, Prefix: "c/", Perms: Read},
		{BucketID: 2, Prefix: "", Perms: Read},
		{BucketID: 2, Prefix: "x/", Perms: All},
		{BucketID: 3, Prefix: "w/", Perms: Create},
	}
	got := EntryPoints(g)
	want := []Grant{
		{BucketID: 1, Prefix: "a/", Perms: Read | Delete},
		{BucketID: 1, Prefix: "c/", Perms: Read},
		{BucketID: 2, Prefix: "", Perms: Read},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("EntryPoints = %+v want %+v", got, want)
	}
}
