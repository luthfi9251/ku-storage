package s3x

import (
	"context"
	"sync"
)

// Pool caches one Client per connection id. Resolve loads the config.
type Pool struct {
	mu      sync.Mutex
	clients map[int64]Client
	resolve func(ctx context.Context, connID int64) (Config, error)
	newFn   func(Config) (Client, error)
}

func NewPool(resolve func(ctx context.Context, connID int64) (Config, error)) *Pool {
	return &Pool{clients: map[int64]Client{}, resolve: resolve, newFn: New}
}

func (p *Pool) Get(ctx context.Context, connID int64) (Client, error) {
	p.mu.Lock()
	c, ok := p.clients[connID]
	p.mu.Unlock()
	if ok {
		return c, nil
	}
	cfg, err := p.resolve(ctx, connID)
	if err != nil {
		return nil, err
	}
	c, err = p.newFn(cfg)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	p.clients[connID] = c
	p.mu.Unlock()
	return c, nil
}

// Invalidate drops the cached client (after the connection changed).
func (p *Pool) Invalidate(connID int64) {
	p.mu.Lock()
	delete(p.clients, connID)
	p.mu.Unlock()
}
