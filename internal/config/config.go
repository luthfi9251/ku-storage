package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr       string
	DBPath     string
	CryptKey   string
	PublicURL  string
	TrustProxy bool
	MaxUpload  int64
	AuditDays  int
}

func Load() (Config, error) {
	c := Config{
		Addr:      getenv("KUSTORAGE_ADDR", ":8080"),
		DBPath:    getenv("KUSTORAGE_DB", "ku-storage.db"),
		CryptKey:  os.Getenv("KUSTORAGE_CRYPT_KEY"),
		PublicURL: strings.TrimRight(os.Getenv("KUSTORAGE_PUBLIC_URL"), "/"),
	}
	var err error
	if c.TrustProxy, err = parseBool(getenv("KUSTORAGE_TRUST_PROXY", "false")); err != nil {
		return c, fmt.Errorf("KUSTORAGE_TRUST_PROXY: %w", err)
	}
	if c.MaxUpload, err = ParseSize(getenv("KUSTORAGE_MAX_UPLOAD", "5GiB")); err != nil {
		return c, fmt.Errorf("KUSTORAGE_MAX_UPLOAD: %w", err)
	}
	if c.AuditDays, err = strconv.Atoi(getenv("KUSTORAGE_AUDIT_DAYS", "365")); err != nil || c.AuditDays < 1 {
		return c, fmt.Errorf("KUSTORAGE_AUDIT_DAYS must be a positive integer")
	}
	if c.PublicURL != "" && !strings.HasPrefix(c.PublicURL, "http://") && !strings.HasPrefix(c.PublicURL, "https://") {
		return c, fmt.Errorf("KUSTORAGE_PUBLIC_URL must start with http:// or https://")
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func parseBool(v string) (bool, error) { return strconv.ParseBool(strings.TrimSpace(v)) }

// ParseSize parses sizes like "500MiB", "5GiB", "1GB" or plain bytes.
func ParseSize(v string) (int64, error) {
	v = strings.TrimSpace(v)
	units := []struct {
		suffix string
		mult   int64
	}{
		{"TiB", 1 << 40}, {"GiB", 1 << 30}, {"MiB", 1 << 20}, {"KiB", 1 << 10},
		{"TB", 1e12}, {"GB", 1e9}, {"MB", 1e6}, {"KB", 1e3}, {"B", 1},
	}
	mult := int64(1)
	for _, u := range units {
		if strings.HasSuffix(v, u.suffix) {
			mult, v = u.mult, strings.TrimSpace(strings.TrimSuffix(v, u.suffix))
			break
		}
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("invalid size")
	}
	return n * mult, nil
}
