package meta

import (
	"context"
	"database/sql"
	"time"
)

type Session struct {
	ID         int64
	UserID     int64
	IP         string
	UserAgent  string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

// CreateSession stores a session keyed by the SHA-256 of its token.
func (s *Store) CreateSession(ctx context.Context, tokenHash string, userID int64, ip, ua string, ttl time.Duration) (int64, error) {
	now := s.now()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, ip, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tokenHash, userID, ip, ua, now.Unix(), now.Unix(), now.Add(ttl).Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// LookupSession returns a live session and its user. Expired sessions or
// disabled users yield ErrNotFound.
func (s *Store) LookupSession(ctx context.Context, tokenHash string) (*Session, *User, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT s.id, s.user_id, s.ip, s.user_agent, s.created_at, s.last_seen_at, s.expires_at,
       u.id, u.username, u.display_name, u.password_hash, u.role, u.disabled, u.created_at, u.last_login_at
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`, tokenHash, s.unix())
	var se Session
	var u User
	var sc, sl, sx, uc, ul int64
	if err := row.Scan(&se.ID, &se.UserID, &se.IP, &se.UserAgent, &sc, &sl, &sx,
		&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.Role, &u.Disabled, &uc, &ul); err != nil {
		return nil, nil, err
	}
	se.CreatedAt, se.LastSeenAt, se.ExpiresAt = fromUnix(sc), fromUnix(sl), fromUnix(sx)
	u.CreatedAt, u.LastLoginAt = fromUnix(uc), fromUnix(ul)
	return &se, &u, nil
}

// TouchSession slides the expiry to now+ttl, capped at createdAt+maxAge.
func (s *Store) TouchSession(ctx context.Context, id int64, ip string, ttl, maxAge time.Duration) error {
	now := s.now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET last_seen_at = ?, ip = ?, expires_at = MIN(?, created_at + ?) WHERE id = ?`,
		now.Unix(), ip, now.Add(ttl).Unix(), int64(maxAge/time.Second), id)
	return err
}

func (s *Store) ListSessions(ctx context.Context, userID int64) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions
		 WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`, userID, s.unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var se Session
		var c, l, x int64
		if err := rows.Scan(&se.ID, &se.UserID, &se.IP, &se.UserAgent, &c, &l, &x); err != nil {
			return nil, err
		}
		se.CreatedAt, se.LastSeenAt, se.ExpiresAt = fromUnix(c), fromUnix(l), fromUnix(x)
		out = append(out, se)
	}
	return out, rows.Err()
}

func (s *Store) DeleteSession(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func (s *Store) DeleteSessionForUser(ctx context.Context, userID, id int64) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeleteUserSessions removes all sessions of a user except keepID (0 = none kept).
func (s *Store) DeleteUserSessions(ctx context.Context, userID, keepID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND id != ?`, userID, keepID)
	return err
}

// Invite is a one-time token to set a password (invite or reset).
type Invite struct {
	ID        int64
	UserID    int64
	Purpose   string
	ExpiresAt time.Time
}

// CreateInvite stores a new invite and invalidates earlier unused ones for the user.
func (s *Store) CreateInvite(ctx context.Context, tokenHash string, userID int64, purpose string, ttl time.Duration) (time.Time, error) {
	now := s.now()
	exp := now.Add(ttl)
	err := s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at = 0`, now.Unix(), userID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO invites (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
			tokenHash, userID, purpose, now.Unix(), exp.Unix())
		return err
	})
	return exp.UTC().Truncate(time.Second), err
}

// GetInvite returns an unused, unexpired invite.
func (s *Store) GetInvite(ctx context.Context, tokenHash string) (*Invite, error) {
	var inv Invite
	var exp int64
	err := s.db.QueryRowContext(ctx,
		`SELECT i.id, i.user_id, i.purpose, i.expires_at FROM invites i JOIN users u ON u.id = i.user_id
		 WHERE i.token_hash = ? AND i.used_at = 0 AND i.expires_at > ? AND u.disabled = 0`, tokenHash, s.unix()).
		Scan(&inv.ID, &inv.UserID, &inv.Purpose, &exp)
	if err != nil {
		return nil, err
	}
	inv.ExpiresAt = fromUnix(exp)
	return &inv, nil
}

// UseInvite atomically consumes the invite, sets the password and drops all
// sessions of the user. Returns ErrNotFound if the invite was already used.
func (s *Store) UseInvite(ctx context.Context, inviteID, userID int64, passwordHash string) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE invites SET used_at = ? WHERE id = ? AND used_at = 0`, s.unix(), inviteID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
		return err
	})
}

// PurgeExpired deletes expired sessions and stale invites.
func (s *Store) PurgeExpired(ctx context.Context) error {
	now := s.unix()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, now); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM invites WHERE expires_at <= ? OR used_at != 0`, now-7*24*3600)
	return err
}
