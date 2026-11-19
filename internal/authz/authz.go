// Package authz holds the pure access-control rules of ku-storage: object key
// validation, prefix normalisation and evaluation of effective permissions from
// grants. It performs no I/O so every rule can be table-tested.
package authz

import (
	"errors"
	"sort"
	"strings"
	"unicode/utf8"
)

// Perm is a bitmask of object permissions.
type Perm uint8

const (
	Read Perm = 1 << iota
	Create
	Update
	Delete

	None Perm = 0
	All       = Read | Create | Update | Delete
)

// Has reports whether p contains every bit of q.
func (p Perm) Has(q Perm) bool { return p&q == q }

// Valid reports whether p only uses known bits and, when it grants anything
// beyond Read, also grants Read (a write-only grant is useless in the UI).
func (p Perm) Valid() bool {
	if p&^All != 0 || p == None {
		return false
	}
	return p.Has(Read)
}

// Grant is one access rule: Perms on every key of BucketID starting with Prefix.
// Prefix is normalised: "" (whole bucket) or ending with "/".
type Grant struct {
	BucketID int64
	Prefix   string
	Perms    Perm
}

const MaxKeyBytes = 1024

var ErrInvalidKey = errors.New("invalid object key")

// ValidateKey checks an object key. A trailing "/" (folder marker) is allowed.
func ValidateKey(key string) error {
	if key == "" || len(key) > MaxKeyBytes || !utf8.ValidString(key) {
		return ErrInvalidKey
	}
	if strings.HasPrefix(key, "/") || strings.Contains(key, "//") {
		return ErrInvalidKey
	}
	for _, r := range key {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return ErrInvalidKey
		}
	}
	for _, seg := range strings.Split(strings.TrimSuffix(key, "/"), "/") {
		if seg == "." || seg == ".." {
			return ErrInvalidKey
		}
	}
	return nil
}

// ValidateName checks a single path segment (new file or folder name).
func ValidateName(name string) error {
	if name == "" || strings.Contains(name, "/") {
		return ErrInvalidKey
	}
	return ValidateKey(name)
}

// NormalizePrefix returns "" or a valid key ending with "/".
func NormalizePrefix(p string) (string, error) {
	if p == "" {
		return "", nil
	}
	if !strings.HasSuffix(p, "/") {
		p += "/"
	}
	if err := ValidateKey(p); err != nil {
		return "", err
	}
	return p, nil
}

// Effective returns the union of permissions of grants on bucket whose prefix
// covers key. Because grant prefixes end with "/", a grant on "a/" never
// covers "a-b/x". Permissions are monotonic: Effective(k) ⊇ Effective(parent).
func Effective(grants []Grant, bucket int64, key string) Perm {
	var p Perm
	for _, g := range grants {
		if g.BucketID == bucket && strings.HasPrefix(key, g.Prefix) {
			p |= g.Perms
		}
	}
	return p
}

// VirtualChildren returns the child folder prefixes of prefix that lead to a
// readable grant located strictly below prefix, e.g. prefix "" with a grant on
// "a/b/" yields ["a/"]. Sorted, unique.
func VirtualChildren(grants []Grant, bucket int64, prefix string) []string {
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		return nil
	}
	seen := map[string]bool{}
	for _, g := range grants {
		if g.BucketID != bucket || !g.Perms.Has(Read) {
			continue
		}
		if len(g.Prefix) <= len(prefix) || !strings.HasPrefix(g.Prefix, prefix) {
			continue
		}
		rest := g.Prefix[len(prefix):]
		child := prefix + rest[:strings.IndexByte(rest, '/')+1]
		seen[child] = true
	}
	out := make([]string, 0, len(seen))
	for c := range seen {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

// CanSee reports whether a user may open prefix: either it is readable, or it
// is an ancestor of a readable grant (virtual navigation).
func CanSee(grants []Grant, bucket int64, prefix string) bool {
	return Effective(grants, bucket, prefix).Has(Read) || len(VirtualChildren(grants, bucket, prefix)) > 0
}

// EntryPoints returns the top-most readable grant prefixes per bucket (a
// prefix lying inside another readable prefix is dropped), with the effective
// permissions at that prefix. Sorted by bucket then prefix.
func EntryPoints(grants []Grant) []Grant {
	var readable []Grant
	for _, g := range grants {
		if g.Perms.Has(Read) {
			readable = append(readable, g)
		}
	}
	var out []Grant
	seen := map[[2]any]bool{}
	for _, g := range readable {
		covered := false
		for _, o := range readable {
			if o.BucketID == g.BucketID && len(o.Prefix) < len(g.Prefix) && strings.HasPrefix(g.Prefix, o.Prefix) {
				covered = true
				break
			}
		}
		k := [2]any{g.BucketID, g.Prefix}
		if covered || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, Grant{BucketID: g.BucketID, Prefix: g.Prefix, Perms: Effective(grants, g.BucketID, g.Prefix)})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].BucketID != out[j].BucketID {
			return out[i].BucketID < out[j].BucketID
		}
		return out[i].Prefix < out[j].Prefix
	})
	return out
}
