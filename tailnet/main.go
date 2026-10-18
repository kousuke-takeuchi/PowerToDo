// powertodo-tailnet runs an embedded Tailscale node (tsnet) for PowerToDo and
// talks to the parent app with one JSON object per line on stdin / stdout.
// It exits when stdin is closed. See docs/superpowers/specs/2026-10-16-phase4-sync-design.md section 4.1.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
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

// out serializes writes so each JSON object stays on its own line.
type out struct {
	mu sync.Mutex
	w  *os.File
}

func (o *out) send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: encode:", err)
		return
	}
	b = append(b, '\n')
	o.mu.Lock()
	defer o.mu.Unlock()
	if _, err := o.w.Write(b); err != nil {
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: write:", err)
	}
}

func discardLogf(string, ...any) {}

func main() {
	dir := flag.String("dir", "", "state directory")
	hostname := flag.String("hostname", "", "tailnet host name")
	flag.Parse()
	if *dir == "" || *hostname == "" {
		fmt.Fprintln(os.Stderr, "usage: powertodo-tailnet --dir <state dir> --hostname <name>")
		os.Exit(2)
	}
	os.Exit(run(*dir, *hostname, os.Stdin, &out{w: os.Stdout}))
}

func run(dir, hostname string, stdin *os.File, o *out) int {
	// The parent sets this too; make sure it holds before tsnet is created.
	if os.Getenv("TS_NO_LOGS_NO_SUPPORT") == "" {
		os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fail(o, "state dir: "+err.Error())
	}

	srv := &tsnet.Server{
		Dir:      dir,
		Hostname: hostname,
		Logf:     discardLogf,
		UserLogf: discardLogf,
	}
	if err := srv.Start(); err != nil {
		return fail(o, "start: "+err.Error())
	}
	// Close can block on a stuck network; never let shutdown hang.
	defer closeBounded(srv)

	addr, proxyCred, _, err := srv.Loopback()
	if err != nil {
		return fail(o, "loopback: "+err.Error())
	}
	lc, err := srv.LocalClient()
	if err != nil {
		return fail(o, "local client: "+err.Error())
	}

	o.send(ReadyMsg{Type: "ready", Proxy: fmt.Sprintf("socks5h://%s:%s@%s", proxyUser, proxyCred, addr)})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go statusLoop(ctx, lc, o)

	// Read commands in a goroutine: a blocked pipe read cannot be interrupted,
	// so the main goroutine waits on EOF or a signal instead.
	scanDone := make(chan struct{})
	go func() {
		defer close(scanDone)
		sc := bufio.NewScanner(stdin)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Bytes()
			if len(line) == 0 {
				continue
			}
			var cmd Command
			if err := json.Unmarshal(line, &cmd); err != nil {
				fmt.Fprintln(os.Stderr, "powertodo-tailnet: bad command:", err)
				// Best effort: a partly decoded command may still carry its id.
				if cmd.ID != nil {
					o.send(DoneMsg{Type: "done", ID: cmd.ID, Error: "unknown_command"})
				}
				continue
			}
			go handle(ctx, lc, o, cmd)
		}
		if err := sc.Err(); err != nil {
			fmt.Fprintln(os.Stderr, "powertodo-tailnet: stdin:", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	select {
	case <-scanDone: // stdin closed: the parent is gone
	case <-sig:
	}
	cancel()
	return 0
}

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

func fail(o *out, msg string) int {
	fmt.Fprintln(os.Stderr, "powertodo-tailnet:", msg)
	o.send(StatusMsg{Type: "status", State: StateFailed, Error: msg})
	return 1
}

// statusLoop reports the node state once right away and then whenever it changes.
func statusLoop(ctx context.Context, lc *local.Client, o *out) {
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
			o.send(msg)
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

func handle(ctx context.Context, lc *local.Client, o *out, cmd Command) {
	timeout := requestTimeout
	if cmd.Cmd == "logout" {
		timeout = logoutTimeout
	}
	c, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	switch cmd.Cmd {
	case "login":
		o.send(done(cmd.ID, lc.StartLoginInteractive(c)))
	case "logout":
		o.send(done(cmd.ID, lc.Logout(c)))
	case "resolve":
		st, err := lc.Status(c)
		if err != nil {
			o.send(ResolvedMsg{Type: "resolved", ID: cmd.ID, Error: err.Error()})
			return
		}
		o.send(resolveMsg(cmd.ID, st, cmd.Host))
	default:
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: unknown command:", cmd.Cmd)
		if cmd.ID != nil {
			o.send(DoneMsg{Type: "done", ID: cmd.ID, Error: "unknown_command"})
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
