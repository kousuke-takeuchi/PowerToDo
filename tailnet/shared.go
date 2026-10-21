package main

// Code shared by the desktop sidecar (main.go) and the iOS library
// (mobile_ios.go): the node's status polling and command handling. The output
// goes through a send function, so each side keeps its own transport.

import (
	"context"
	"fmt"
	"os"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

const (
	pollInterval   = 2 * time.Second
	requestTimeout = 10 * time.Second
	logoutTimeout  = 90 * time.Second
	closeTimeout   = 5 * time.Second
	proxyUser      = "tsnet"
)

func discardLogf(string, ...any) {}

func closeBounded(srv *tsnet.Server) {
	done := make(chan struct{})
	go func() {
		srv.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(closeTimeout):
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: close timed out")
	}
}

// statusLoop reports the node state once right away and then whenever it changes.
func statusLoop(ctx context.Context, lc *local.Client, send func(any)) {
	var last StatusMsg
	first := true
	poll := func() {
		c, cancel := context.WithTimeout(ctx, requestTimeout)
		defer cancel()
		st, err := lc.Status(c)
		if ctx.Err() != nil {
			return
		}
		msg := statusMsg(st, err)
		if first || msg != last {
			first = false
			last = msg
			send(msg)
		}
	}
	poll()
	t := time.NewTicker(pollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			poll()
		}
	}
}

func handle(ctx context.Context, lc *local.Client, send func(any), cmd Command) {
	timeout := requestTimeout
	if cmd.Cmd == "logout" {
		timeout = logoutTimeout
	}
	c, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	switch cmd.Cmd {
	case "login":
		send(done(cmd.ID, lc.StartLoginInteractive(c)))
	case "logout":
		send(done(cmd.ID, lc.Logout(c)))
	case "resolve":
		st, err := lc.Status(c)
		if err != nil {
			send(ResolvedMsg{Type: "resolved", ID: cmd.ID, Error: err.Error()})
			return
		}
		send(resolveMsg(cmd.ID, st, cmd.Host))
	default:
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: unknown command:", cmd.Cmd)
		if cmd.ID != nil {
			send(DoneMsg{Type: "done", ID: cmd.ID, Error: "unknown_command"})
		}
	}
}

func done(id *int64, err error) DoneMsg {
	m := DoneMsg{Type: "done", ID: id}
	if err != nil {
		m.Error = err.Error()
	}
	return m
}
