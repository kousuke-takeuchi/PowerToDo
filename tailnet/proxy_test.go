package main

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"
)

func dial() func(context.Context, string, string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext
}

func TestProxyReopensOnTheSamePort(t *testing.T) {
	p := newProxyServer(dial(), "tsnet", "secret")
	first, err := p.Open()
	if err != nil {
		t.Fatal(err)
	}
	port := p.Port()
	p.Close()
	// The closed port refuses connections.
	if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second); err == nil {
		c.Close()
		t.Fatal("closed listener still accepts")
	}
	second, err := p.Open()
	if err != nil {
		t.Fatal(err)
	}
	if p.Port() != port || second != first {
		t.Fatalf("port %d -> %d, url %q -> %q", port, p.Port(), first, second)
	}
	p.Close()
}

func TestProxyFallsBackToANewPortWhenTheOldOneIsTaken(t *testing.T) {
	p := newProxyServer(dial(), "tsnet", "secret")
	if _, err := p.Open(); err != nil {
		t.Fatal(err)
	}
	port := p.Port()
	p.Close()
	squat, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Skip("port reused by someone else already")
	}
	defer squat.Close()
	if _, err := p.Open(); err != nil {
		t.Fatal(err)
	}
	if p.Port() == port {
		t.Fatal("expected a new port")
	}
	p.Close()
}

func TestProxyOpenWhileOpenKeepsOneWorkingListener(t *testing.T) {
	p := newProxyServer(dial(), "tsnet", "secret")
	first, err := p.Open()
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.Open() // closes the first listener, then binds the same port again
	if err != nil {
		t.Fatal(err)
	}
	if second != first {
		t.Fatalf("url %q -> %q", first, second)
	}
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", p.Port()), time.Second)
	if err != nil {
		t.Fatalf("listener does not accept: %v", err)
	}
	c.Close()
	p.Close()
}
