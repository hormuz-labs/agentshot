package mobile

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestMeshTargets(t *testing.T) {
	for _, target := range []string{"100.64.0.1:47821", "[fd7a:115c:a1e0::1]:47821"} {
		if err := meshTarget(target); err != nil {
			t.Fatal(err)
		}
	}
	for _, target := range []string{"127.0.0.1:47821", "example.com:443", "100.128.0.1:47821", "[::1]:47821", "100.64.0.1"} {
		if meshTarget(target) == nil {
			t.Fatalf("accepted non-mesh target %s", target)
		}
	}
}

func TestConnectPreservesBufferedTLS(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go serveProxy(func(_ context.Context, _, target string) (net.Conn, error) {
		if target != "100.64.0.1:47821" {
			t.Errorf("unexpected target %s", target)
		}
		a, b := net.Pipe()
		go func() { defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}, ln)
	c, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(3 * time.Second))
	// TLS can arrive in the same TCP packet as the CONNECT headers.
	io.WriteString(c, "CONNECT 100.64.0.1:47821 HTTP/1.1\r\nHost: 100.64.0.1:47821\r\n\r\nopaque-TLS")
	reader := bufio.NewReader(c)
	response, err := http.ReadResponse(reader, &http.Request{Method: "CONNECT"})
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("CONNECT: %v %v", response, err)
	}
	got := make([]byte, len("opaque-TLS"))
	if _, err := io.ReadFull(reader, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != "opaque-TLS" {
		t.Fatalf("lost buffered bytes: %q", got)
	}
}
