package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/luthfi9251/ku-storage/internal/api"
	"github.com/luthfi9251/ku-storage/internal/config"
	"github.com/luthfi9251/ku-storage/internal/cryptx"
	"github.com/luthfi9251/ku-storage/internal/meta"
	"github.com/luthfi9251/ku-storage/internal/s3x"
	"github.com/luthfi9251/ku-storage/web"
)

// csp allows previews (img/media/iframe) from any storage origin, since the
// download endpoint redirects to presigned URLs on the storage host.
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https: http:; media-src 'self' https: http:; " +
	"frame-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// version is set at build time: -ldflags "-X main.version=v1.0.0".
var version = "dev"

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-v" || os.Args[1] == "version") {
		fmt.Println("ku-storage", version)
		return
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	keyPath := filepath.Join(filepath.Dir(cfg.DBPath), ".ku-storage-key")
	key, err := cryptx.LoadOrGenerateKey(cfg.CryptKey, keyPath)
	if err != nil {
		log.Fatal(err)
	}
	cx, err := cryptx.New(key)
	if err != nil {
		log.Fatal(err)
	}
	st, err := meta.Open(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	pool := s3x.NewPool(func(ctx context.Context, connID int64) (s3x.Config, error) {
		c, err := st.GetConnection(ctx, connID)
		if err != nil {
			return s3x.Config{}, fmt.Errorf("connection %d not found", connID)
		}
		secret, err := cx.Decrypt(c.SecretEnc)
		if err != nil {
			return s3x.Config{}, fmt.Errorf("decrypt connection secret: %w", err)
		}
		return s3x.Config{Kind: c.Kind, AccountID: c.AccountID, Endpoint: c.Endpoint, Region: c.Region,
			PathStyle: c.PathStyle, AccessKey: c.AccessKey, SecretKey: secret}, nil
	})

	limiter := api.NewRateLimiter()
	handler := api.NewServer(api.Deps{
		Store: st, Crypt: cx, Storage: pool, Limiter: limiter,
		Options: api.Options{PublicURL: cfg.PublicURL, TrustProxy: cfg.TrustProxy, MaxUpload: cfg.MaxUpload},
	})
	mux := http.NewServeMux()
	mux.Handle("/api/", handler)
	mux.Handle("/", web.Handler())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go housekeeping(ctx, st, limiter, cfg.AuditDays)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// No Read/WriteTimeout: uploads of several GB stream through.
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("ku-storage %s listening on %s (db %s)", version, cfg.Addr, cfg.DBPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func housekeeping(ctx context.Context, st *meta.Store, limiter *api.RateLimiter, auditDays int) {
	run := func() {
		if err := st.PurgeExpired(ctx); err != nil {
			log.Printf("purge sessions: %v", err)
		}
		if n, err := st.PurgeAudit(ctx, time.Now().AddDate(0, 0, -auditDays)); err != nil {
			log.Printf("purge audit: %v", err)
		} else if n > 0 {
			log.Printf("purged %d audit entries older than %d days", n, auditDays)
		}
		limiter.Sweep()
	}
	run()
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
