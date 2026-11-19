package api

import (
	"log"
	"time"

	"github.com/luthfi9251/ku-storage/internal/authz"
	"github.com/luthfi9251/ku-storage/internal/meta"
)

func internalLog(what string, err error) { log.Printf("%s: %v", what, err) }

type permsDTO struct {
	Read   bool `json:"read"`
	Create bool `json:"create"`
	Update bool `json:"update"`
	Delete bool `json:"delete"`
}

func toPermsDTO(p authz.Perm) permsDTO {
	return permsDTO{Read: p.Has(authz.Read), Create: p.Has(authz.Create), Update: p.Has(authz.Update), Delete: p.Has(authz.Delete)}
}

func (p permsDTO) perm() authz.Perm {
	var out authz.Perm
	if p.Read {
		out |= authz.Read
	}
	if p.Create {
		out |= authz.Create
	}
	if p.Update {
		out |= authz.Update
	}
	if p.Delete {
		out |= authz.Delete
	}
	return out
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func tsPtr(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := ts(t)
	return &s
}

type meUserDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

func toMeUser(u *meta.User) meUserDTO {
	return meUserDTO{ID: encID(u.ID), Username: u.Username, DisplayName: u.DisplayName, Role: u.Role}
}

type entryPointDTO struct {
	BucketID       string   `json:"bucketId"`
	BucketName     string   `json:"bucketName"`
	DisplayName    string   `json:"displayName"`
	ConnectionName string   `json:"connectionName"`
	Prefix         string   `json:"prefix"`
	Perms          permsDTO `json:"perms"`
}

func newEntryPoint(b *meta.Bucket, prefix string, p authz.Perm) entryPointDTO {
	return entryPointDTO{BucketID: encID(b.ID), BucketName: b.Name, DisplayName: b.Label(),
		ConnectionName: b.ConnectionName, Prefix: prefix, Perms: toPermsDTO(p)}
}

type groupRefDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type userDTO struct {
	ID          string        `json:"id"`
	Username    string        `json:"username"`
	DisplayName string        `json:"displayName"`
	Role        string        `json:"role"`
	Disabled    bool          `json:"disabled"`
	Pending     bool          `json:"pending"`
	CreatedAt   string        `json:"createdAt"`
	LastLoginAt *string       `json:"lastLoginAt"`
	Groups      []groupRefDTO `json:"groups"`
}

func toUserDTO(u *meta.User, groups []groupRefDTO) userDTO {
	if groups == nil {
		groups = []groupRefDTO{}
	}
	return userDTO{ID: encID(u.ID), Username: u.Username, DisplayName: u.DisplayName, Role: u.Role,
		Disabled: u.Disabled, Pending: u.Pending(), CreatedAt: ts(u.CreatedAt), LastLoginAt: tsPtr(u.LastLoginAt), Groups: groups}
}

type memberDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type groupDTO struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	CreatedAt string      `json:"createdAt"`
	Members   []memberDTO `json:"members"`
}

type bucketDTO struct {
	ID             string `json:"id"`
	ConnectionID   string `json:"connectionId"`
	ConnectionName string `json:"connectionName"`
	Name           string `json:"name"`
	DisplayName    string `json:"displayName"`
	CreatedAt      string `json:"createdAt"`
	GrantCount     int    `json:"grantCount"`
}

func toBucketDTO(b *meta.Bucket) bucketDTO {
	return bucketDTO{ID: encID(b.ID), ConnectionID: encID(b.ConnectionID), ConnectionName: b.ConnectionName,
		Name: b.Name, DisplayName: b.DisplayName, CreatedAt: ts(b.CreatedAt), GrantCount: b.GrantCount}
}

type connectionDTO struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Kind      string      `json:"kind"`
	AccountID string      `json:"accountId"`
	Endpoint  string      `json:"endpoint"`
	Region    string      `json:"region"`
	PathStyle bool        `json:"pathStyle"`
	AccessKey string      `json:"accessKey"`
	HasSecret bool        `json:"hasSecret"`
	CreatedAt string      `json:"createdAt"`
	Buckets   []bucketDTO `json:"buckets"`
}

type grantDTO struct {
	ID          string   `json:"id"`
	SubjectType string   `json:"subjectType"`
	SubjectID   string   `json:"subjectId"`
	SubjectName string   `json:"subjectName"`
	BucketID    string   `json:"bucketId"`
	BucketName  string   `json:"bucketName"`
	Prefix      string   `json:"prefix"`
	Perms       permsDTO `json:"perms"`
	CreatedAt   string   `json:"createdAt"`
	Via         string   `json:"via,omitempty"`
}

func toGrantDTO(g *meta.Grant) grantDTO {
	return grantDTO{ID: encID(g.ID), SubjectType: g.SubjectType, SubjectID: encID(g.SubjectID), SubjectName: g.SubjectName,
		BucketID: encID(g.BucketID), BucketName: g.BucketName, Prefix: g.Prefix, Perms: toPermsDTO(authz.Perm(g.Perms)),
		CreatedAt: ts(g.CreatedAt)}
}

type auditDTO struct {
	ID         string  `json:"id"`
	TS         string  `json:"ts"`
	UserID     *string `json:"userId"`
	Username   string  `json:"username"`
	IP         string  `json:"ip"`
	Action     string  `json:"action"`
	BucketName string  `json:"bucketName"`
	Key        string  `json:"key"`
	Size       int64   `json:"size"`
	Result     string  `json:"result"`
	Detail     string  `json:"detail"`
}

func toAuditDTO(e *meta.AuditEntry) auditDTO {
	d := auditDTO{ID: encID(e.ID), TS: ts(e.TS), Username: e.Username, IP: e.IP, Action: e.Action,
		BucketName: e.BucketName, Key: e.Key, Size: e.Size, Result: e.Result, Detail: e.Detail}
	if e.UserID != 0 {
		id := encID(e.UserID)
		d.UserID = &id
	}
	return d
}
