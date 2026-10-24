// Embedded userspace Headscale/Tailscale (tsnet) mesh helper: no OS VPN, root, or Tailscale app required.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

type readyMsg struct {
	IP        string `json:"ip"`
	Listen    int    `json:"listenPort,omitempty"`
	ProxyPort int    `json:"proxyPort,omitempty"`
}

func main() {
	stateDir := flag.String("state-dir", "", "tsnet state directory")
	hostname := flag.String("hostname", "manul-node", "mesh node hostname")
	controlURL := flag.String("control-url", "", "Headscale control URL")
	authKey := flag.String("auth-key", "", "pre-auth key")
	ephemeral := flag.Bool("ephemeral", false, "ephemeral node")
	forwardPort := flag.Int("forward-port", 0, "local port on 127.0.0.1 to expose on mesh :47821")
	meshPort := flag.Int("mesh-port", 47821, "mesh port to listen on when forwarding")
	flag.Parse()

	if *stateDir == "" {
		fmt.Fprintln(os.Stderr, "--state-dir is required")
		os.Exit(1)
	}

	srv := &tsnet.Server{
		Dir:        *stateDir,
		Hostname:   *hostname,
		ControlURL: *controlURL,
		AuthKey:    *authKey,
		Ephemeral:  *ephemeral,
		Logf:       func(string, ...any) {},
	}
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	status, err := srv.Up(ctx)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "tsnet up failed: %v\n", err)
		os.Exit(1)
	}

	var ip string
	for _, addr := range status.TailscaleIPs {
		if addr.Is4() {
			ip = addr.String()
			break
		}
	}

	if *forwardPort > 0 {
		ln, err := srv.Listen("tcp", fmt.Sprintf(":%d", *meshPort))
		if err != nil {
			fmt.Fprintf(os.Stderr, "mesh listen failed: %v\n", err)
			os.Exit(1)
		}
		defer ln.Close()
		go func() {
			for {
				conn, err := ln.Accept()
				if err != nil {
					return
				}
				go pipeToLocal(conn, *forwardPort)
			}
		}()
	}

	out, _ := json.Marshal(readyMsg{IP: ip, Listen: *meshPort})
	fmt.Println(string(out))

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}

func pipeToLocal(meshConn net.Conn, localPort int) {
	defer meshConn.Close()
	localConn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", localPort), 5*time.Second)
	if err != nil {
		return
	}
	defer localConn.Close()
	done := make(chan struct{}, 2)
	go func() { io.Copy(localConn, meshConn); done <- struct{}{} }()
	go func() { io.Copy(meshConn, localConn); done <- struct{}{} }()
	<-done
}
