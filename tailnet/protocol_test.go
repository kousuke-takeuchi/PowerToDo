package main

import (
	"encoding/json"
	"errors"
	"net/netip"
	"testing"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/types/key"
)

func ips(s ...string) []netip.Addr {
	var out []netip.Addr
	for _, v := range s {
		out = append(out, netip.MustParseAddr(v))
	}
	return out
}

func TestMapState(t *testing.T) {
	cases := []struct{ backend, url, want string }{
		{"NeedsLogin", "https://login.tailscale.com/a/x", "needs_login"},
		{"NeedsLogin", "", "starting"},
		{"NeedsMachineAuth", "", "needs_approval"},
		{"Running", "", "running"},
		{"Stopped", "", "stopped"},
		{"Starting", "", "starting"},
		{"NoState", "", "starting"},
		{"", "", "starting"},
	}
	for _, c := range cases {
		if got := mapState(c.backend, c.url); got != c.want {
			t.Errorf("mapState(%q,%q) = %q, want %q", c.backend, c.url, got, c.want)
		}
	}
}

func TestMatchPeer(t *testing.T) {
	peers := []Peer{
		{DNSName: "nas.tail1234.ts.net.", HostName: "DiskStation", TailscaleIPs: ips("fd7a:115c:a1e0::5", "100.64.0.5")},
		{DNSName: "laptop.tail1234.ts.net.", HostName: "nas", TailscaleIPs: ips("100.64.0.9")},
		{DNSName: "", HostName: "bare", TailscaleIPs: ips("100.64.0.7")},
	}
	cases := []struct {
		host string
		ip   string
		ok   bool
	}{
		{"nas", "100.64.0.5", true}, // short name wins over the HostName of another peer
		{"nas.tail1234.ts.net", "100.64.0.5", true},
		{"nas.tail1234.ts.net.", "100.64.0.5", true},
		{"NAS.Tail1234.TS.net", "100.64.0.5", true},
		{"NAS", "100.64.0.5", true},
		{"100.64.0.5", "100.64.0.5", true},
		{"fd7a:115c:a1e0::5", "100.64.0.5", true},
		{"[fd7a:115c:a1e0::5]", "100.64.0.5", true},
		{"diskstation", "100.64.0.5", true},
		{"bare", "100.64.0.7", true},
		{"laptop", "100.64.0.9", true},
		{"unknown", "", false},
		{"unknown.tail1234.ts.net", "", false},
		{"100.64.0.99", "", false},
		{"nas.example.com", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		ip, ok := matchPeer(peers, c.host)
		if ip != c.ip || ok != c.ok {
			t.Errorf("matchPeer(%q) = (%q,%v), want (%q,%v)", c.host, ip, ok, c.ip, c.ok)
		}
	}
	if _, ok := matchPeer(nil, "nas"); ok {
		t.Error("no peers must not match")
	}
}

func TestMatchPeerPrefersIPv4(t *testing.T) {
	peers := []Peer{{DNSName: "nas.t.ts.net.", TailscaleIPs: ips("fd7a:115c:a1e0::5", "100.64.0.5")}}
	if ip, _ := matchPeer(peers, "nas"); ip != "100.64.0.5" {
		t.Errorf("got %q, want the IPv4 address", ip)
	}
	v6only := []Peer{{DNSName: "nas.t.ts.net.", TailscaleIPs: ips("fd7a:115c:a1e0::5")}}
	if ip, ok := matchPeer(v6only, "nas"); !ok || ip != "fd7a:115c:a1e0::5" {
		t.Errorf("got (%q,%v), want the IPv6 address", ip, ok)
	}
}

func TestPeersOfExcludesSelf(t *testing.T) {
	self := &ipnstate.PeerStatus{DNSName: "powertodo-mac.t.ts.net.", HostName: "powertodo-mac", TailscaleIPs: ips("100.64.0.1")}
	st := &ipnstate.Status{
		Self: self,
		Peer: map[key.NodePublic]*ipnstate.PeerStatus{
			key.NewNode().Public(): {DNSName: "nas.t.ts.net.", HostName: "nas", TailscaleIPs: ips("100.64.0.5")},
			key.NewNode().Public(): nil,
		},
	}
	peers := peersOf(st)
	if len(peers) != 1 {
		t.Fatalf("got %d peers, want 1", len(peers))
	}
	for _, h := range []string{"powertodo-mac", "powertodo-mac.t.ts.net", "100.64.0.1"} {
		if _, ok := matchPeer(peers, h); ok {
			t.Errorf("self (%q) must not resolve", h)
		}
	}
	if ip, ok := matchPeer(peers, "nas"); !ok || ip != "100.64.0.5" {
		t.Errorf("nas = (%q,%v)", ip, ok)
	}
	if peersOf(nil) != nil {
		t.Error("nil status must yield no peers")
	}
}

func TestStatusMsg(t *testing.T) {
	self := &ipnstate.PeerStatus{DNSName: "powertodo-mac.t.ts.net.", TailscaleIPs: ips("fd7a:115c:a1e0::1", "100.64.0.1")}
	cases := []struct {
		name string
		st   *ipnstate.Status
		err  error
		want StatusMsg
	}{
		{"error", nil, errors.New("boom"), StatusMsg{Type: "status", State: "failed", Error: "boom"}},
		{"login", &ipnstate.Status{BackendState: "NeedsLogin", AuthURL: "https://x/y"}, nil, StatusMsg{Type: "status", State: "needs_login", LoginURL: "https://x/y"}},
		{"preparing", &ipnstate.Status{BackendState: "NeedsLogin"}, nil, StatusMsg{Type: "status", State: "starting"}},
		{"approval", &ipnstate.Status{BackendState: "NeedsMachineAuth"}, nil, StatusMsg{Type: "status", State: "needs_approval"}},
		{"running", &ipnstate.Status{BackendState: "Running", Self: self}, nil, StatusMsg{Type: "status", State: "running", Name: "powertodo-mac.t.ts.net", IP: "100.64.0.1"}},
		{"stopped", &ipnstate.Status{BackendState: "Stopped"}, nil, StatusMsg{Type: "status", State: "stopped"}},
	}
	for _, c := range cases {
		if got := statusMsg(c.st, c.err); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestJSONShape(t *testing.T) {
	id := int64(7)
	cases := []struct {
		v    any
		want string
	}{
		{ReadyMsg{Type: "ready", Proxy: "socks5h://tsnet:p@127.0.0.1:1"}, `{"type":"ready","proxy":"socks5h://tsnet:p@127.0.0.1:1"}`},
		{StatusMsg{Type: "status", State: "needs_login", LoginURL: "https://x"}, `{"type":"status","state":"needs_login","loginUrl":"https://x"}`},
		{ResolvedMsg{Type: "resolved", ID: &id, IP: "100.64.0.5"}, `{"type":"resolved","id":7,"ip":"100.64.0.5"}`},
		{ResolvedMsg{Type: "resolved", ID: &id, Error: "not_in_tailnet"}, `{"type":"resolved","id":7,"error":"not_in_tailnet"}`},
		{DoneMsg{Type: "done", ID: &id}, `{"type":"done","id":7}`},
		{DoneMsg{Type: "done", ID: &id, Error: "x"}, `{"type":"done","id":7,"error":"x"}`},
	}
	for _, c := range cases {
		b, err := json.Marshal(c.v)
		if err != nil || string(b) != c.want {
			t.Errorf("got %s (%v), want %s", b, err, c.want)
		}
	}
	zero := int64(0)
	b, _ := json.Marshal(DoneMsg{Type: "done", ID: &zero})
	if string(b) != `{"type":"done","id":0}` {
		t.Errorf("id 0 must be kept: %s", b)
	}
	var cmd Command
	if err := json.Unmarshal([]byte(`{"cmd":"resolve","id":3,"host":"nas"}`), &cmd); err != nil || cmd.Cmd != "resolve" || cmd.ID == nil || *cmd.ID != 3 || cmd.Host != "nas" {
		t.Errorf("bad command parse: %+v %v", cmd, err)
	}
}

func TestResolveMsg(t *testing.T) {
	id := int64(4)
	peer := map[key.NodePublic]*ipnstate.PeerStatus{
		key.NewNode().Public(): {DNSName: "nas.t.ts.net.", TailscaleIPs: ips("100.64.0.5")},
	}
	cases := []struct {
		name string
		st   *ipnstate.Status
		host string
		want ResolvedMsg
	}{
		{"found", &ipnstate.Status{BackendState: "Running", Peer: peer}, "nas", ResolvedMsg{Type: "resolved", ID: &id, IP: "100.64.0.5"}},
		{"missing", &ipnstate.Status{BackendState: "Running", Peer: peer}, "other", ResolvedMsg{Type: "resolved", ID: &id, Error: "not_in_tailnet"}},
		{"needs login", &ipnstate.Status{BackendState: "NeedsLogin", Peer: peer}, "nas", ResolvedMsg{Type: "resolved", ID: &id, Error: "not_running"}},
		{"starting", &ipnstate.Status{BackendState: "Starting"}, "nas", ResolvedMsg{Type: "resolved", ID: &id, Error: "not_running"}},
		{"nil", nil, "nas", ResolvedMsg{Type: "resolved", ID: &id, Error: "not_running"}},
	}
	for _, c := range cases {
		if got := resolveMsg(&id, c.st, c.host); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}
