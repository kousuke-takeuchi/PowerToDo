//go:build ios

// This is the iOS build of powertodo-tailnet: the same tsnet node and JSON
// protocol as the desktop sidecar (main.go, protocol.go, shared.go), but linked
// into the app as a c-archive and driven through a small C API instead of
// stdin / stdout. Build it with scripts/build-tailnet-ios.sh.
//
// Messages are the protocol's JSON objects (ReadyMsg, StatusMsg, ResolvedMsg,
// DoneMsg); commands are the protocol's Command JSON.
//
// The SOCKS5 proxy is a proxyServer (proxy.go), not tsnet's Server.Loopback:
// iOS reclaims the listening socket of a suspended app, so the proxy is closed
// and opened again around a suspension, on the same port when possible.
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
	"unsafe"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

const queueSize = 256

func main() {} // required by -buildmode=c-archive

// node is the one tsnet server of this process.
type node struct {
	srv    *tsnet.Server
	lc     *local.Client
	ctx    context.Context
	cancel context.CancelFunc

	proxy *proxyServer
}

var (
	mu     sync.Mutex
	cur    *node
	events = make(chan []byte, queueSize)
)

// send queues one message for tn_next_event. A full queue drops the message:
// status is sent again on the next change, and a command reply that is lost
// times out on the Rust side.
func send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: encode:", err)
		return
	}
	select {
	case events <- b:
	default:
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: event queue full, dropped a message")
	}
}

// tn_start starts the node with its state in stateDir. Returns 0 on success,
// 1 when a node is already running, 2 when it could not start (a failed
// status event says why).
//
//export tn_start
func tn_start(stateDir, hostname *C.char) C.int {
	mu.Lock()
	defer mu.Unlock()
	if cur != nil {
		return 1
	}
	dir, host := C.GoString(stateDir), C.GoString(hostname)
	// Same as the desktop sidecar: no log upload to Tailscale.
	if os.Getenv("TS_NO_LOGS_NO_SUPPORT") == "" {
		os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		send(StatusMsg{Type: "status", State: StateFailed, Error: "state dir: " + err.Error()})
		return 2
	}
	srv := &tsnet.Server{Dir: dir, Hostname: host, Logf: discardLogf, UserLogf: discardLogf}
	if err := srv.Start(); err != nil {
		send(StatusMsg{Type: "status", State: StateFailed, Error: "start: " + err.Error()})
		return 2
	}
	lc, err := srv.LocalClient()
	if err != nil {
		closeBounded(srv)
		send(StatusMsg{Type: "status", State: StateFailed, Error: "local client: " + err.Error()})
		return 2
	}
	ctx, cancel := context.WithCancel(context.Background())
	n := &node{srv: srv, lc: lc, ctx: ctx, cancel: cancel, proxy: newProxyServer(srv.Dial, proxyUser, randomCred())}
	cur = n
	go statusLoop(ctx, lc, send)
	return 0
}

func randomCred() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand does not fail on Apple platforms
	}
	return hex.EncodeToString(b)
}

func current() *node {
	mu.Lock()
	defer mu.Unlock()
	return cur
}

// tn_command handles one protocol command (JSON). The reply arrives as an
// event. Returns 0, or -1 when no node runs or the JSON is not a command.
//
//export tn_command
func tn_command(line *C.char) C.int {
	n := current()
	if n == nil {
		return -1
	}
	var cmd Command
	if err := json.Unmarshal([]byte(C.GoString(line)), &cmd); err != nil {
		return -1
	}
	go handle(n.ctx, n.lc, send, cmd)
	return 0
}

// tn_next_event waits up to timeoutMs for the next message. Returns a JSON
// string to be released with tn_free, or NULL on timeout.
//
//export tn_next_event
func tn_next_event(timeoutMs C.int) *C.char {
	t := time.NewTimer(time.Duration(timeoutMs) * time.Millisecond)
	defer t.Stop()
	select {
	case b := <-events:
		return C.CString(string(b))
	case <-t.C:
		return nil
	}
}

// tn_proxy_open (re)opens the SOCKS5 listener on 127.0.0.1 and returns its
// socks5h:// URL (release with tn_free), or NULL when no node runs or
// listening fails. It tries the port of the previous open first, and a new port
// when that one is taken. An open listener is closed first. A ready event with
// the same URL is queued too.
//
//export tn_proxy_open
func tn_proxy_open() *C.char {
	n := current()
	if n == nil {
		return nil
	}
	url, err := n.proxy.Open()
	if err != nil {
		fmt.Fprintln(os.Stderr, "powertodo-tailnet: proxy listen:", err)
		return nil
	}
	send(ReadyMsg{Type: "ready", Proxy: url})
	return C.CString(url)
}

// tn_proxy_close closes the SOCKS5 listener (call before the app is suspended).
//
//export tn_proxy_close
func tn_proxy_close() {
	if n := current(); n != nil {
		n.proxy.Close()
	}
}

// tn_rebind tells the node's network monitor that the network may have changed
// (call when the app comes back to the foreground), so it re-checks the
// interfaces and reconnects. Does nothing when no node runs.
//
//export tn_rebind
func tn_rebind() {
	n := current()
	if n == nil {
		return
	}
	if mon, ok := n.srv.Sys().NetMon.GetOK(); ok {
		mon.InjectEvent()
	}
}

// tn_stop closes the proxy and the node (bounded to a few seconds). The state
// directory is kept; tn_start can be called again.
//
//export tn_stop
func tn_stop() {
	mu.Lock()
	n := cur
	cur = nil
	mu.Unlock()
	if n == nil {
		return
	}
	n.cancel()
	n.proxy.Close()
	closeBounded(n.srv)
	send(StatusMsg{Type: "status", State: StateStopped})
}

// tn_free releases a string returned by this library.
//
//export tn_free
func tn_free(p *C.char) {
	C.free(unsafe.Pointer(p))
}
