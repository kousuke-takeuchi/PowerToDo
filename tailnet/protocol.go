package main

import (
	"net/netip"
	"sort"
	"strings"

	"tailscale.com/ipn/ipnstate"
)

// Peer is the subset of ipnstate.PeerStatus used to resolve a host name.
type Peer struct {
	DNSName      string
	HostName     string
	TailscaleIPs []netip.Addr
}

// Status messages (child -> parent).
const (
	StateStopped       = "stopped"
	StateNeedsLogin    = "needs_login"
	StateNeedsApproval = "needs_approval"
	StateStarting      = "starting"
	StateRunning       = "running"
	StateFailed        = "failed"
)

// ReadyMsg is sent once, after the tsnet server has started.
type ReadyMsg struct {
	Type  string `json:"type"`
	Proxy string `json:"proxy"`
}

// StatusMsg is sent on start and whenever the node state changes.
type StatusMsg struct {
	Type     string `json:"type"`
	State    string `json:"state"`
	Name     string `json:"name,omitempty"`
	IP       string `json:"ip,omitempty"`
	LoginURL string `json:"loginUrl,omitempty"`
	Error    string `json:"error,omitempty"`
}

// ResolvedMsg answers a resolve command.
type ResolvedMsg struct {
	Type  string `json:"type"`
	ID    *int64 `json:"id,omitempty"`
	IP    string `json:"ip,omitempty"`
	Error string `json:"error,omitempty"`
}

// DoneMsg answers a login or logout command.
type DoneMsg struct {
	Type  string `json:"type"`
	ID    *int64 `json:"id,omitempty"`
	Error string `json:"error,omitempty"`
}

// Command is a parent -> child message.
type Command struct {
	Cmd  string `json:"cmd"`
	ID   *int64 `json:"id,omitempty"`
	Host string `json:"host,omitempty"`
}

// mapState converts an ipn BackendState and AuthURL to a protocol state.
func mapState(backendState, authURL string) string {
	switch backendState {
	case "NeedsLogin":
		if authURL != "" {
			return StateNeedsLogin
		}
		return StateStarting
	case "NeedsMachineAuth":
		return StateNeedsApproval
	case "Running":
		return StateRunning
	case "Stopped":
		return StateStopped
	default:
		return StateStarting
	}
}

// pickIP returns the first IPv4 address, else the first address, else "".
func pickIP(ips []netip.Addr) string {
	for _, ip := range ips {
		if ip.Is4() {
			return ip.String()
		}
	}
	if len(ips) > 0 {
		return ips[0].String()
	}
	return ""
}

// normalizeHost lower-cases a host and strips IPv6 brackets and trailing dots.
func normalizeHost(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	h = strings.TrimPrefix(h, "[")
	h = strings.TrimSuffix(h, "]")
	return strings.TrimRight(h, ".")
}

// matchPeer finds the tailnet peer a host name refers to and returns its
// address (IPv4 preferred). The order of the rules is: FQDN, IP address,
// MagicDNS short name (first label of the FQDN), HostName. Each rule is tried
// across all peers before the next one.
func matchPeer(peers []Peer, host string) (ip string, ok bool) {
	h := normalizeHost(host)
	if h == "" {
		return "", false
	}
	addr, addrErr := netip.ParseAddr(h)
	find := func(match func(p Peer) bool) (string, bool) {
		for _, p := range peers {
			if match(p) {
				if ip := pickIP(p.TailscaleIPs); ip != "" {
					return ip, true
				}
			}
		}
		return "", false
	}
	fqdn := func(p Peer) string { return normalizeHost(p.DNSName) }
	rules := []func(p Peer) bool{
		func(p Peer) bool { return fqdn(p) != "" && fqdn(p) == h },
		func(p Peer) bool {
			if addrErr != nil {
				return false
			}
			for _, a := range p.TailscaleIPs {
				if a.Unmap() == addr.Unmap() {
					return true
				}
			}
			return false
		},
		func(p Peer) bool {
			short, _, _ := strings.Cut(fqdn(p), ".")
			return short != "" && short == h
		},
		func(p Peer) bool {
			return p.HostName != "" && strings.ToLower(p.HostName) == h
		},
	}
	for _, rule := range rules {
		if ip, ok := find(rule); ok {
			return ip, true
		}
	}
	return "", false
}

// peersOf lists the other nodes of the tailnet. Self is never included.
func peersOf(st *ipnstate.Status) []Peer {
	if st == nil {
		return nil
	}
	peers := make([]Peer, 0, len(st.Peer))
	for _, p := range st.Peer {
		if p == nil {
			continue
		}
		peers = append(peers, Peer{DNSName: p.DNSName, HostName: p.HostName, TailscaleIPs: p.TailscaleIPs})
	}
	// Map order is random; keep the match deterministic.
	sort.Slice(peers, func(i, j int) bool { return peers[i].DNSName < peers[j].DNSName })
	return peers
}

// statusMsg builds the status message for a LocalAPI status result.
func statusMsg(st *ipnstate.Status, err error) StatusMsg {
	if err != nil {
		return StatusMsg{Type: "status", State: StateFailed, Error: err.Error()}
	}
	state := mapState(st.BackendState, st.AuthURL)
	msg := StatusMsg{Type: "status", State: state}
	switch state {
	case StateNeedsLogin:
		msg.LoginURL = st.AuthURL
	case StateRunning:
		ips := st.TailscaleIPs
		if st.Self != nil {
			msg.Name = strings.TrimRight(st.Self.DNSName, ".")
			if len(st.Self.TailscaleIPs) > 0 {
				ips = st.Self.TailscaleIPs
			}
		}
		msg.IP = pickIP(ips)
	}
	return msg
}

// resolveMsg answers a resolve command from a LocalAPI status. Peers are only
// reliable while the node is running, so any other state answers not_running.
func resolveMsg(id *int64, st *ipnstate.Status, host string) ResolvedMsg {
	msg := ResolvedMsg{Type: "resolved", ID: id}
	if st == nil || st.BackendState != "Running" {
		msg.Error = "not_running"
		return msg
	}
	if ip, ok := matchPeer(peersOf(st), host); ok {
		msg.IP = ip
	} else {
		msg.Error = "not_in_tailnet"
	}
	return msg
}
