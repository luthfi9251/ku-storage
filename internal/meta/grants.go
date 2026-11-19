package meta

import (
	"context"
	"database/sql"
	"time"
)

type Grant struct {
	ID          int64
	SubjectType string // user | group
	SubjectID   int64
	SubjectName string
	BucketID    int64
	BucketName  string
	Prefix      string
	Perms       uint8
	CreatedAt   time.Time
}

const grantSelect = `SELECT g.id, g.subject_type, g.subject_id,
  COALESCE(CASE g.subject_type WHEN 'user' THEN (SELECT username FROM users WHERE id = g.subject_id)
                               ELSE (SELECT name FROM groups WHERE id = g.subject_id) END, ''),
  g.bucket_id, b.name, g.prefix, g.perms, g.created_at
FROM grants g JOIN buckets b ON b.id = g.bucket_id`

func scanGrant(r scanner) (*Grant, error) {
	var g Grant
	var created int64
	if err := r.Scan(&g.ID, &g.SubjectType, &g.SubjectID, &g.SubjectName, &g.BucketID, &g.BucketName, &g.Prefix, &g.Perms, &created); err != nil {
		return nil, err
	}
	g.CreatedAt = fromUnix(created)
	return &g, nil
}

func (s *Store) queryGrants(ctx context.Context, where string, args ...any) ([]Grant, error) {
	rows, err := s.db.QueryContext(ctx, grantSelect+" "+where+` ORDER BY b.name, g.prefix, g.subject_type, g.subject_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Grant
	for rows.Next() {
		g, err := scanGrant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *g)
	}
	return out, rows.Err()
}

type GrantFilter struct {
	BucketID    int64
	SubjectType string
	SubjectID   int64
}

func (s *Store) ListGrants(ctx context.Context, f GrantFilter) ([]Grant, error) {
	where := "WHERE 1=1"
	var args []any
	if f.BucketID != 0 {
		where += " AND g.bucket_id = ?"
		args = append(args, f.BucketID)
	}
	if f.SubjectType != "" {
		where += " AND g.subject_type = ?"
		args = append(args, f.SubjectType)
	}
	if f.SubjectID != 0 {
		where += " AND g.subject_id = ?"
		args = append(args, f.SubjectID)
	}
	return s.queryGrants(ctx, where, args...)
}

// UserGrants returns the grants applying to a user: direct ones and those of
// the groups they belong to.
func (s *Store) UserGrants(ctx context.Context, userID int64) ([]Grant, error) {
	return s.queryGrants(ctx, `WHERE (g.subject_type = 'user' AND g.subject_id = ?)
   OR (g.subject_type = 'group' AND g.subject_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`, userID, userID)
}

func (s *Store) GetGrant(ctx context.Context, id int64) (*Grant, error) {
	return scanGrant(s.db.QueryRowContext(ctx, grantSelect+` WHERE g.id = ?`, id))
}

// SubjectExists checks that a user or group id exists.
func (s *Store) SubjectExists(ctx context.Context, typ string, id int64) (bool, error) {
	table := "users"
	if typ == "group" {
		table = "groups"
	}
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table+` WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

// UpsertGrant creates the grant or replaces perms of the existing one with the
// same subject, bucket and prefix. Returns the grant id.
func (s *Store) UpsertGrant(ctx context.Context, g Grant, createdBy int64) (int64, error) {
	var id int64
	err := s.tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO grants (subject_type, subject_id, bucket_id, prefix, perms, created_by, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (subject_type, subject_id, bucket_id, prefix) DO UPDATE SET perms = excluded.perms`,
			g.SubjectType, g.SubjectID, g.BucketID, g.Prefix, g.Perms, createdBy, s.unix())
		if err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT id FROM grants WHERE subject_type = ? AND subject_id = ? AND bucket_id = ? AND prefix = ?`,
			g.SubjectType, g.SubjectID, g.BucketID, g.Prefix).Scan(&id)
	})
	return id, err
}

// UpdateGrant changes prefix and perms. ErrConflict if another grant of the
// same subject already uses that prefix.
func (s *Store) UpdateGrant(ctx context.Context, id int64, prefix string, perms uint8) error {
	res, err := s.db.ExecContext(ctx, `UPDATE grants SET prefix = ?, perms = ? WHERE id = ?`, prefix, perms, id)
	if isUnique(err) {
		return ErrConflict
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteGrant(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM grants WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
