//go:build !ios

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

	"tailscale.com/tsnet"
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
	go statusLoop(ctx, lc, o.send)

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
			go handle(ctx, lc, o.send, cmd)
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

func fail(o *out, msg string) int {
	fmt.Fprintln(os.Stderr, "powertodo-tailnet:", msg)
	o.send(StatusMsg{Type: "status", State: StateFailed, Error: msg})
	return 1
}
