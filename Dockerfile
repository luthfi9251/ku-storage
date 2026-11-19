FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /ku-storage ./cmd/ku-storage

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /ku-storage /ku-storage
ENV KUSTORAGE_ADDR=:8080 KUSTORAGE_DB=/data/ku-storage.db
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/ku-storage"]
