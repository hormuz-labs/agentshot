package main

import (
	"context"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tailscale.com/derp"
	"tailscale.com/derp/derphttp"
	"tailscale.com/net/netmon"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

// Real upstream DERP clients through an authenticated HTTP CONNECT proxy.
// The destination deliberately has no DNS record; the proxy resolves it.
func TestDERPThroughAuthenticatedProxy(t *testing.T) {
	noop := func(string, ...any) {}
	d := derp.NewServer(key.NewNode(), noop)
	defer d.Close()
	server := httptest.NewTLSServer(derphttp.Handler(d))
	defer server.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := proxyAuth(r)
		if r.Method != "CONNECT" || !ok || user != "mesh" || password != "password" {
			w.WriteHeader(407)
			return
		}
		up, err := net.Dial("tcp", server.Listener.Addr().String())
		if err != nil {
			w.WriteHeader(502)
			return
		}
		client, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			up.Close()
			return
		}
		go func() {
			defer client.Close()
			defer up.Close()
			io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
			done := make(chan struct{}, 2)
			go func() { io.Copy(up, buffered); done <- struct{}{} }()
			go func() { io.Copy(client, up); done <- struct{}{} }()
			<-done
		}()
	}))
	defer proxy.Close()
	t.Setenv("HTTPS_PROXY", "http://mesh:password@"+proxy.Listener.Addr().String())
	t.Setenv("https_proxy", "")
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
	monitor, err := netmon.New(noop)
	if err != nil {
		t.Fatal(err)
	}
	defer monitor.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	// Upstream tlsdial verifies against the system pool, not TLSConfig.RootCAs.
	t.Setenv("GODEBUG", "x509usefallbackroots=1")
	x509.SetFallbackRoots(roots)
	region := &tailcfg.DERPRegion{RegionID: 1, Nodes: []*tailcfg.DERPNode{{Name: "test", RegionID: 1, HostName: "unresolvable.example.com"}}}
	aKey, bKey := key.NewNode(), key.NewNode()
	a := derphttp.NewRegionClient(aKey, noop, monitor, func() *tailcfg.DERPRegion { return region })
	b := derphttp.NewRegionClient(bKey, noop, monitor, func() *tailcfg.DERPRegion { return region })
	defer a.Close()
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.Connect(ctx); err != nil {
		t.Fatal(err)
	}
	if err := b.Connect(ctx); err != nil {
		t.Fatal(err)
	}
	// Consume server info: Connect's write can finish before registration on
	// the remote server, so sending immediately otherwise races the receiver.
	if _, err := a.Recv(); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Recv(); err != nil {
		t.Fatal(err)
	}
	if err := a.Send(bKey.Public(), []byte("encrypted-video-packet")); err != nil {
		t.Fatal(err)
	}
	got := make(chan []byte, 1)
	go func() {
		for {
			message, err := b.Recv()
			if err != nil {
				return
			}
			if packet, ok := message.(derp.ReceivedPacket); ok {
				got <- append([]byte(nil), packet.Data...)
				return
			}
		}
	}()
	select {
	case data := <-got:
		if string(data) != "encrypted-video-packet" {
			t.Fatalf("bad payload %q", data)
		}
	case <-ctx.Done():
		t.Fatal("DERP packet not received")
	}
}

func proxyAuth(r *http.Request) (string, string, bool) {
	copy := r.Clone(r.Context())
	copy.Header.Set("Authorization", r.Header.Get("Proxy-Authorization"))
	return copy.BasicAuth()
}
