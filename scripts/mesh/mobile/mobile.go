// Package mobile embeds a userspace Headscale/Tailscale (tsnet) node in the phone app (built with gomobile).
// The app's HTTP client reaches mesh peers through a local CONNECT proxy, so TLS stays end to end and pinned.
package mobile

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"tailscale.com/envknob"
	"tailscale.com/logtail"
	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
)

var (
	mu      sync.Mutex // guards the node; held across Up, so nothing Up calls back into may take it
	srv     *tsnet.Server
	proxy   net.Listener
	ip      string
	verbose bool

	ifMu       sync.Mutex // netmon asks for interfaces while Up runs
	interfaces []netmon.Interface
)

// SetVerbose writes the node's logs to mesh.log in its state directory; off by default.
func SetVerbose(on bool) { verbose = on }

// SetInterfaces supplies the device's network interfaces, since Android 11+ blocks Go's net.Interfaces.
// One interface per line: "name index mtu up loopback addr/prefix addr/prefix ...".
func SetInterfaces(spec string) {
	var list []netmon.Interface
	for _, line := range strings.Split(strings.TrimSpace(spec), "\n") {
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		index, _ := strconv.Atoi(f[1])
		mtu, _ := strconv.Atoi(f[2])
		var flags net.Flags
		if f[3] == "1" {
			flags |= net.FlagUp | net.FlagRunning
		}
		if f[4] == "1" {
			flags |= net.FlagLoopback
		}
		var addrs []net.Addr
		for _, a := range f[5:] {
			if p, err := netip.ParsePrefix(a); err == nil {
				addrs = append(addrs, &net.IPNet{IP: p.Addr().AsSlice(), Mask: net.CIDRMask(p.Bits(), p.Addr().BitLen())})
			}
		}
		list = append(list, netmon.Interface{Interface: &net.Interface{Name: f[0], Index: index, MTU: mtu, Flags: flags}, AltAddrs: addrs})
	}
	ifMu.Lock()
	interfaces = list
	ifMu.Unlock()
}

func init() {
	// a private Headscale mesh: never upload node logs to Tailscale's log service
	envknob.SetNoLogsNoSupport()
	logtail.Disable()
	netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
		ifMu.Lock()
		defer ifMu.Unlock()
		return append([]netmon.Interface(nil), interfaces...), nil
	})
}

// Start joins the mesh (authKey is only needed the first time; the node key persists in stateDir)
// and returns {"ip": "100.x.y.z", "proxyPort": n}. Calling it again while running returns the same.
func Start(stateDir, hostname, controlURL, authKey string) (string, error) {
	mu.Lock()
	defer mu.Unlock()
	if srv != nil {
		return ready()
	}
	// Tailscale looks for a system log directory (/var/lib/tailscale…) that Android doesn't have, and panics
	os.Setenv("TS_LOGS_DIR", stateDir)
	logf := func(string, ...any) {}
	if verbose {
		if f, err := os.OpenFile(filepath.Join(stateDir, "mesh.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600); err == nil {
			logf = log.New(f, "", log.LstdFlags).Printf
			// a stuck start leaves no error to report: dump every goroutine to the log instead
			started := make(chan struct{})
			defer close(started)
			go func() {
				select {
				case <-started:
				case <-time.After(20 * time.Second):
					buf := make([]byte, 1<<20)
					logf("start still running after 20s:\n%s", buf[:runtime.Stack(buf, true)])
				}
			}()
		}
	}
	s := &tsnet.Server{
		Dir:        stateDir,
		Hostname:   hostname,
		ControlURL: controlURL,
		AuthKey:    authKey,
		Logf:       logf,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	status, err := s.Up(ctx)
	cancel()
	if err != nil {
		s.Close()
		return "", err
	}
	for _, a := range status.TailscaleIPs {
		if a.Is4() {
			ip = a.String()
			break
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		s.Close()
		return "", err
	}
	srv, proxy = s, ln
	go serveProxy(s, ln)
	return ready()
}

// Stop leaves the mesh and closes the proxy.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	if proxy != nil {
		proxy.Close()
	}
	if srv != nil {
		srv.Close()
	}
	srv, proxy, ip = nil, nil, ""
}

func ready() (string, error) {
	out, err := json.Marshal(map[string]any{"ip": ip, "proxyPort": proxy.Addr().(*net.TCPAddr).Port})
	return string(out), err
}

// serveProxy accepts HTTP CONNECT for mesh addresses only and tunnels the bytes through tsnet.
func serveProxy(s *tsnet.Server, ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer c.Close()
			req, err := http.ReadRequest(bufio.NewReader(c))
			if err != nil || req.Method != http.MethodConnect {
				io.WriteString(c, "HTTP/1.1 405 Method Not Allowed\r\n\r\n")
				return
			}
			if err := meshTarget(req.Host); err != nil {
				io.WriteString(c, "HTTP/1.1 403 Forbidden\r\n\r\n")
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			up, err := s.Dial(ctx, "tcp", req.Host)
			cancel()
			if err != nil {
				io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
				return
			}
			defer up.Close()
			io.WriteString(c, "HTTP/1.1 200 Connection Established\r\n\r\n")
			done := make(chan struct{}, 2)
			go func() { io.Copy(up, c); done <- struct{}{} }()
			go func() { io.Copy(c, up); done <- struct{}{} }()
			<-done
		}()
	}
}

var meshV4 = netip.MustParsePrefix("100.64.0.0/10")
var meshV6 = netip.MustParsePrefix("fd7a:115c:a1e0::/48")

func meshTarget(hostport string) error {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		return err
	}
	a, err := netip.ParseAddr(host)
	if err != nil || !(meshV4.Contains(a) || meshV6.Contains(a)) {
		return errors.New("not a mesh address")
	}
	return nil
}
