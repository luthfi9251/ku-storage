package config

import "testing"

func TestParseSize(t *testing.T) {
	cases := map[string]int64{"5GiB": 5 << 30, "500MiB": 500 << 20, "1GB": 1e9, "1024": 1024, "10 MiB": 10 << 20}
	for in, want := range cases {
		got, err := ParseSize(in)
		if err != nil || got != want {
			t.Errorf("ParseSize(%q) = %d, %v want %d", in, got, err, want)
		}
	}
	for _, in := range []string{"", "x", "-1", "0", "5XB"} {
		if _, err := ParseSize(in); err == nil {
			t.Errorf("ParseSize(%q) want error", in)
		}
	}
}

func TestLoadDefaults(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" || c.MaxUpload != 5<<30 || c.AuditDays != 365 || c.TrustProxy {
		t.Fatalf("defaults: %+v", c)
	}
	t.Setenv("KUSTORAGE_PUBLIC_URL", "files.example.com")
	if _, err := Load(); err == nil {
		t.Fatal("public url without scheme should fail")
	}
}
