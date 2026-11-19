package meta

import (
	"context"
	"database/sql"
	"time"
)

type Group struct {
	ID        int64
	Name      string
	CreatedAt time.Time
	Members   []int64
}

func (s *Store) ListGroups(ctx context.Context) ([]Group, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, created_at FROM groups ORDER BY name`)
	if err != nil {
		return nil, err
	}
	var out []Group
	idx := map[int64]int{}
	for rows.Next() {
		var g Group
		var c int64
		if err := rows.Scan(&g.ID, &g.Name, &c); err != nil {
			rows.Close()
			return nil, err
		}
		g.CreatedAt = fromUnix(c)
		idx[g.ID] = len(out)
		out = append(out, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	mrows, err := s.db.QueryContext(ctx, `SELECT group_id, user_id FROM group_members ORDER BY user_id`)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var gid, uid int64
		if err := mrows.Scan(&gid, &uid); err != nil {
			return nil, err
		}
		if i, ok := idx[gid]; ok {
			out[i].Members = append(out[i].Members, uid)
		}
	}
	return out, mrows.Err()
}

func (s *Store) GetGroup(ctx context.Context, id int64) (*Group, error) {
	gs, err := s.ListGroups(ctx)
	if err != nil {
		return nil, err
	}
	for _, g := range gs {
		if g.ID == id {
			return &g, nil
		}
	}
	return nil, ErrNotFound
}

// UserGroupIDs returns the ids of groups the user belongs to.
func (s *Store) UserGroupIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT group_id FROM group_members WHERE user_id = ? ORDER BY group_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func setMembers(ctx context.Context, tx *sql.Tx, groupID int64, members []int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE group_id = ?`, groupID); err != nil {
		return err
	}
	for _, u := range members {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`, groupID, u); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CreateGroup(ctx context.Context, name string, members []int64) (int64, error) {
	var id int64
	err := s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `INSERT INTO groups (name, created_at) VALUES (?, ?)`, name, s.unix())
		if isUnique(err) {
			return ErrConflict
		}
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		return setMembers(ctx, tx, id, members)
	})
	return id, err
}

func (s *Store) UpdateGroup(ctx context.Context, id int64, name string, members []int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE groups SET name = ? WHERE id = ?`, name, id)
		if isUnique(err) {
			return ErrConflict
		}
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return setMembers(ctx, tx, id, members)
	})
}

// DeleteGroup removes the group, its memberships and its grants.
func (s *Store) DeleteGroup(ctx context.Context, id int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM grants WHERE subject_type = 'group' AND subject_id = ?`, id); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM groups WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}
