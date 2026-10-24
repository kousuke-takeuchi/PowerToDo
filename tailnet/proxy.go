package main

import (
	"context"
	"fmt"
	"net"
	"sync"

	"tailscale.com/net/socks5"
)

// proxyServer is a SOCKS5 proxy on 127.0.0.1 that can be closed and opened
// again. It is ours, not tsnet's Server.Loopback: Loopback opens its listener
// once and caches it, and iOS reclaims the listening socket of a suspended app
// (tailscale/tailscale#20060). Open tries the previous port first, so URLs the
// app already handed out stay valid across a suspension.
type proxyServer struct {
	dial       func(ctx context.Context, network, addr string) (net.Conn, error)
	user, pass string

	mu   sync.Mutex // serializes Open and Close
	ln   net.Listener
	port int // last bound port; kept after Close so Open can try it again
}

func newProxyServer(dial func(ctx context.Context, network, addr string) (net.Conn, error), user, pass string) *proxyServer {
	return &proxyServer{dial: dial, user: user, pass: pass}
}

// Open closes an open listener, then listens on the previous port (any port the
// first time, or when the previous one is taken). It returns the socks5h:// URL.
func (p *proxyServer) Open() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closeLocked()
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p.port))
	if err != nil && p.port != 0 {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return "", err
	}
	p.ln = ln
	p.port = ln.Addr().(*net.TCPAddr).Port
	s5 := &socks5.Server{Logf: discardLogf, Dialer: p.dial, Username: p.user, Password: p.pass}
	go s5.Serve(ln) // returns when ln is closed
	return fmt.Sprintf("socks5h://%s:%s@%s", p.user, p.pass, ln.Addr()), nil
}

// Close stops listening. Connections already accepted are left alone.
func (p *proxyServer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closeLocked()
}

func (p *proxyServer) closeLocked() {
	if p.ln != nil {
		p.ln.Close()
		p.ln = nil
	}
}

// Port is the port of the last Open (0 before the first).
func (p *proxyServer) Port() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.port
}
