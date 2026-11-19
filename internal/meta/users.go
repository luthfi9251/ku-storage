package meta

import (
	"context"
	"database/sql"
	"time"
)

type User struct {
	ID           int64
	Username     string
	DisplayName  string
	PasswordHash string
	Role         string
	Disabled     bool
	CreatedAt    time.Time
	LastLoginAt  time.Time
}

func (u *User) IsAdmin() bool { return u.Role == "admin" }

// Pending reports whether the user has never set a password.
func (u *User) Pending() bool { return u.PasswordHash == "" }

const userCols = `id, username, display_name, password_hash, role, disabled, created_at, last_login_at`

type scanner interface{ Scan(...any) error }

func scanUser(r scanner) (*User, error) {
	var u User
	var created, last int64
	if err := r.Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.Role, &u.Disabled, &created, &last); err != nil {
		return nil, err
	}
	u.CreatedAt, u.LastLoginAt = fromUnix(created), fromUnix(last)
	return &u, nil
}

func (s *Store) CountUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// CreateUser inserts a user. passwordHash may be empty (pending invite).
// Returns ErrConflict when the username exists.
func (s *Store) CreateUser(ctx context.Context, u User) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
		u.Username, u.DisplayName, u.PasswordHash, u.Role, s.unix())
	if isUnique(err) {
		return 0, ErrConflict
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) GetUser(ctx context.Context, id int64) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id = ?`, id))
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE username = ?`, username))
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+userCols+` FROM users ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func activeAdminsExcept(tx *sql.Tx, ctx context.Context, id int64) (int64, error) {
	var n int64
	err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND password_hash != '' AND id != ?`, id).Scan(&n)
	return n, err
}

// UpdateUser changes profile, role and disabled flag, and replaces group
// membership. Refuses (ErrLastAdmin) to leave no active admin.
func (s *Store) UpdateUser(ctx context.Context, id int64, displayName, role string, disabled bool, groupIDs []int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var curRole string
		var curDisabled bool
		var hash string
		if err := tx.QueryRowContext(ctx, `SELECT role, disabled, password_hash FROM users WHERE id = ?`, id).Scan(&curRole, &curDisabled, &hash); err != nil {
			return err
		}
		wasActiveAdmin := curRole == "admin" && !curDisabled && hash != ""
		if wasActiveAdmin && (role != "admin" || disabled) {
			n, err := activeAdminsExcept(tx, ctx, id)
			if err != nil {
				return err
			}
			if n == 0 {
				return ErrLastAdmin
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET display_name = ?, role = ?, disabled = ? WHERE id = ?`,
			displayName, role, disabled, id); err != nil {
			return err
		}
		return setUserGroups(ctx, tx, id, groupIDs)
	})
}

func setUserGroups(ctx context.Context, tx *sql.Tx, userID int64, groupIDs []int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, g := range groupIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`, g, userID); err != nil {
			return err
		}
	}
	return nil
}

// SetUserGroups replaces the group membership of a user.
func (s *Store) SetUserGroups(ctx context.Context, userID int64, groupIDs []int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error { return setUserGroups(ctx, tx, userID, groupIDs) })
}

func (s *Store) SetPassword(ctx context.Context, id int64, hash string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, id)
	return err
}

func (s *Store) TouchLogin(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET last_login_at = ? WHERE id = ?`, s.unix(), id)
	return err
}

// DeleteUser removes a user, their sessions, memberships and direct grants.
func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		var role string
		var disabled bool
		var hash string
		if err := tx.QueryRowContext(ctx, `SELECT role, disabled, password_hash FROM users WHERE id = ?`, id).Scan(&role, &disabled, &hash); err != nil {
			return err
		}
		if role == "admin" && !disabled && hash != "" {
			n, err := activeAdminsExcept(tx, ctx, id)
			if err != nil {
				return err
			}
			if n == 0 {
				return ErrLastAdmin
			}
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM grants WHERE subject_type = 'user' AND subject_id = ?`, id); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
		return err
	})
}
