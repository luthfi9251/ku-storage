.PHONY: build web-build dev test integration clean

build: web-build
	go build -o ku-storage ./cmd/ku-storage

web-build:
	npm --prefix web install
	npm --prefix web run build

dev: web-build
	go run ./cmd/ku-storage

test:
	go test ./...

# Needs an S3 endpoint, e.g. `docker compose -f docker-compose.test.yml up -d`.
integration:
	KUSTORAGE_TEST_KIND=s3 KUSTORAGE_TEST_ENDPOINT=http://127.0.0.1:9000 \
	KUSTORAGE_TEST_ACCESS_KEY=minioadmin KUSTORAGE_TEST_SECRET_KEY=minioadmin \
	KUSTORAGE_TEST_REGION=us-east-1 KUSTORAGE_TEST_BUCKET=kus-test KUSTORAGE_TEST_CREATE_BUCKET=1 \
	go test -tags integration -count=1 ./internal/s3x/

clean:
	rm -f ku-storage
