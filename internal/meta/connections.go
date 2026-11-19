package meta

import (
	"context"
	"database/sql"
	"time"
)

type Connection struct {
	ID        int64
	Name      string
	Kind      string // r2 | s3
	AccountID string
	Endpoint  string
	Region    string
	PathStyle bool
	AccessKey string
	SecretEnc string
	CreatedAt time.Time
}

const connCols = `id, name, kind, account_id, endpoint, region, path_style, access_key, secret_enc, created_at`

func scanConn(r scanner) (*Connection, error) {
	var c Connection
	var created int64
	if err := r.Scan(&c.ID, &c.Name, &c.Kind, &c.AccountID, &c.Endpoint, &c.Region, &c.PathStyle, &c.AccessKey, &c.SecretEnc, &created); err != nil {
		return nil, err
	}
	c.CreatedAt = fromUnix(created)
	return &c, nil
}

func (s *Store) ListConnections(ctx context.Context) ([]Connection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+connCols+` FROM connections ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Connection
	for rows.Next() {
		c, err := scanConn(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (s *Store) GetConnection(ctx context.Context, id int64) (*Connection, error) {
	return scanConn(s.db.QueryRowContext(ctx, `SELECT `+connCols+` FROM connections WHERE id = ?`, id))
}

func (s *Store) CreateConnection(ctx context.Context, c Connection) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO connections (name, kind, account_id, endpoint, region, path_style, access_key, secret_enc, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.Name, c.Kind, c.AccountID, c.Endpoint, c.Region, c.PathStyle, c.AccessKey, c.SecretEnc, s.unix())
	if isUnique(err) {
		return 0, ErrConflict
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateConnection overwrites all fields; SecretEnc empty keeps the stored one.
func (s *Store) UpdateConnection(ctx context.Context, c Connection) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE connections SET name = ?, kind = ?, account_id = ?, endpoint = ?, region = ?, path_style = ?, access_key = ?,
		 secret_enc = CASE WHEN ? = '' THEN secret_enc ELSE ? END WHERE id = ?`,
		c.Name, c.Kind, c.AccountID, c.Endpoint, c.Region, c.PathStyle, c.AccessKey, c.SecretEnc, c.SecretEnc, c.ID)
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

// DeleteConnection refuses (ErrConflict) while buckets are registered on it.
func (s *Store) DeleteConnection(ctx context.Context, id int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM buckets WHERE connection_id = ?`, id).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return ErrConflict
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM connections WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

type Bucket struct {
	ID             int64
	ConnectionID   int64
	ConnectionName string
	Name           string
	DisplayName    string
	CreatedAt      time.Time
	GrantCount     int
}

// Label is the display name, falling back to the bucket name.
func (b *Bucket) Label() string {
	if b.DisplayName != "" {
		return b.DisplayName
	}
	return b.Name
}

const bucketSelect = `SELECT b.id, b.connection_id, c.name, b.name, b.display_name, b.created_at,
  (SELECT COUNT(*) FROM grants g WHERE g.bucket_id = b.id)
FROM buckets b JOIN connections c ON c.id = b.connection_id`

func scanBucket(r scanner) (*Bucket, error) {
	var b Bucket
	var created int64
	if err := r.Scan(&b.ID, &b.ConnectionID, &b.ConnectionName, &b.Name, &b.DisplayName, &created, &b.GrantCount); err != nil {
		return nil, err
	}
	b.CreatedAt = fromUnix(created)
	return &b, nil
}

func (s *Store) ListBuckets(ctx context.Context) ([]Bucket, error) {
	rows, err := s.db.QueryContext(ctx, bucketSelect+` ORDER BY c.name, b.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bucket
	for rows.Next() {
		b, err := scanBucket(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

func (s *Store) GetBucket(ctx context.Context, id int64) (*Bucket, error) {
	return scanBucket(s.db.QueryRowContext(ctx, bucketSelect+` WHERE b.id = ?`, id))
}

func (s *Store) CreateBucket(ctx context.Context, connID int64, name, displayName string) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO buckets (connection_id, name, display_name, created_at) VALUES (?, ?, ?, ?)`,
		connID, name, displayName, s.unix())
	if isUnique(err) {
		return 0, ErrConflict
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateBucket(ctx context.Context, id int64, displayName string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE buckets SET display_name = ? WHERE id = ?`, displayName, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteBucket unregisters the bucket; its grants cascade.
func (s *Store) DeleteBucket(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM buckets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
