package api

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"

	"github.com/luthfi9251/ku-storage/internal/meta"
)

func itoa(n int) string { return strconv.Itoa(n) }

func parseDate(v string, endOfDay bool) (time.Time, bool) {
	if v == "" {
		return time.Time{}, true
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t, true
	}
	if t, err := time.Parse("2006-01-02", v); err == nil {
		if endOfDay {
			t = t.Add(24 * time.Hour)
		}
		return t, true
	}
	return time.Time{}, false
}

func auditFilter(w http.ResponseWriter, r *http.Request) (meta.AuditFilter, bool) {
	q := r.URL.Query()
	f := meta.AuditFilter{Action: q.Get("action"), Result: q.Get("result")}
	var err error
	bad := func(msg string) (meta.AuditFilter, bool) {
		fail(w, http.StatusBadRequest, "INVALID_INPUT", msg)
		return f, false
	}
	if v := q.Get("user"); v != "" {
		if f.UserID, err = decID(v); err != nil {
			return bad("invalid user")
		}
	}
	if v := q.Get("bucket"); v != "" {
		if f.BucketID, err = decID(v); err != nil {
			return bad("invalid bucket")
		}
	}
	if v := q.Get("before"); v != "" {
		if f.Before, err = decID(v); err != nil {
			return bad("invalid cursor")
		}
	}
	var ok bool
	if f.From, ok = parseDate(q.Get("from"), false); !ok {
		return bad("invalid from")
	}
	if f.To, ok = parseDate(q.Get("to"), true); !ok {
		return bad("invalid to")
	}
	f.Limit = 100
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 500 {
			return bad("limit must be 1-500")
		}
		f.Limit = n
	}
	return f, true
}

func (s *Server) handleListAudit(w http.ResponseWriter, r *http.Request) {
	f, ok := auditFilter(w, r)
	if !ok {
		return
	}
	want := f.Limit
	f.Limit = want + 1
	es, err := s.Store.ListAudit(r.Context(), f)
	if err != nil {
		internalError(w, "audit", err)
		return
	}
	var next *string
	if len(es) > want {
		es = es[:want]
		c := encID(es[want-1].ID)
		next = &c
	}
	items := []auditDTO{}
	for i := range es {
		items = append(items, toAuditDTO(&es[i]))
	}
	jsonOut(w, http.StatusOK, map[string]any{"items": items, "nextBefore": next})
}

const maxCSVRows = 100000

func (s *Server) handleAuditCSV(w http.ResponseWriter, r *http.Request) {
	f, ok := auditFilter(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="ku-storage-audit-`+time.Now().UTC().Format("20060102-150405")+`.csv"`)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "time", "username", "ip", "action", "bucket", "key", "size", "result", "detail"})
	f.Limit = 500
	rows := 0
	for rows < maxCSVRows {
		es, err := s.Store.ListAudit(r.Context(), f)
		if err != nil || len(es) == 0 {
			break
		}
		for _, e := range es {
			_ = cw.Write([]string{strconv.FormatInt(e.ID, 10), ts(e.TS), e.Username, e.IP, e.Action, e.BucketName,
				csvSafe(e.Key), strconv.FormatInt(e.Size, 10), e.Result, csvSafe(e.Detail)})
		}
		rows += len(es)
		f.Before = es[len(es)-1].ID
	}
	cw.Flush()
}

// csvSafe neutralises spreadsheet formula injection in user-controlled cells.
func csvSafe(v string) string {
	if v != "" && (v[0] == '=' || v[0] == '+' || v[0] == '-' || v[0] == '@' || v[0] == '\t' || v[0] == '\r') {
		return "'" + v
	}
	return v
}
