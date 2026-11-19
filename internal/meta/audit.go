package meta

import (
	"context"
	"time"
)

type AuditEntry struct {
	ID         int64
	TS         time.Time
	UserID     int64
	Username   string
	IP         string
	Action     string
	BucketID   int64
	BucketName string
	Key        string
	Size       int64
	Result     string // ok | denied | error
	Detail     string
}

func (s *Store) InsertAudit(ctx context.Context, e AuditEntry) error {
	ts := e.TS
	if ts.IsZero() {
		ts = s.now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO audit_log (ts, user_id, username, ip, action, bucket_id, bucket_name, key, size_bytes, result, detail)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ts.Unix(), e.UserID, e.Username, e.IP, e.Action, e.BucketID, e.BucketName, e.Key, e.Size, e.Result, e.Detail)
	return err
}

type AuditFilter struct {
	UserID   int64
	BucketID int64
	Action   string // prefix match, e.g. "object." or "object.delete"
	Result   string
	From, To time.Time // inclusive from, exclusive to; zero = open
	Before   int64     // id cursor (exclusive); 0 = newest
	Limit    int
}

// ListAudit returns entries newest first.
func (s *Store) ListAudit(ctx context.Context, f AuditFilter) ([]AuditEntry, error) {
	where := "WHERE 1=1"
	var args []any
	if f.UserID != 0 {
		where += " AND user_id = ?"
		args = append(args, f.UserID)
	}
	if f.BucketID != 0 {
		where += " AND bucket_id = ?"
		args = append(args, f.BucketID)
	}
	if f.Action != "" {
		where += " AND action LIKE ? ESCAPE '\\'"
		args = append(args, escapeLike(f.Action)+"%")
	}
	if f.Result != "" {
		where += " AND result = ?"
		args = append(args, f.Result)
	}
	if !f.From.IsZero() {
		where += " AND ts >= ?"
		args = append(args, f.From.Unix())
	}
	if !f.To.IsZero() {
		where += " AND ts < ?"
		args = append(args, f.To.Unix())
	}
	if f.Before != 0 {
		where += " AND id < ?"
		args = append(args, f.Before)
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 100
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `SELECT id, ts, user_id, username, ip, action, bucket_id, bucket_name, key, size_bytes, result, detail
FROM audit_log `+where+` ORDER BY id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		var ts int64
		if err := rows.Scan(&e.ID, &ts, &e.UserID, &e.Username, &e.IP, &e.Action, &e.BucketID, &e.BucketName, &e.Key, &e.Size, &e.Result, &e.Detail); err != nil {
			return nil, err
		}
		e.TS = fromUnix(ts)
		out = append(out, e)
	}
	return out, rows.Err()
}

// PurgeAudit deletes entries older than the cutoff.
func (s *Store) PurgeAudit(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM audit_log WHERE ts < ?`, before.Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func escapeLike(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '%' || r == '_' || r == '\\' {
			out = append(out, '\\')
		}
		out = append(out, r)
	}
	return string(out)
}
