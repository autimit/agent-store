package httpapi

import (
	"autimit.local/agent-store/internal/store"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

func (s *Server) browserAccount(r *http.Request) (string, error) {
	target, e := url.Parse(s.AuthURL)
	if e != nil || target.Scheme != "http" || !net.ParseIP(target.Hostname()).IsLoopback() {
		return "", &store.Fault{Code: "auth_unavailable", Message: "Não foi possível conferir sua conta. Tente novamente.", Status: 503}
	}
	if r.Header.Get("Cookie") == "" {
		return "", &store.Fault{Code: "login_required", Message: "Entre na sua conta para continuar a compra.", Status: 401}
	}
	req, e := http.NewRequestWithContext(r.Context(), "GET", s.AuthURL+"/api/auth/get-session", nil)
	if e != nil {
		return "", e
	}
	req.Header.Set("Cookie", r.Header.Get("Cookie"))
	client := s.authHTTPClient
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	res, e := client.Do(req)
	if e != nil {
		return "", &store.Fault{Code: "auth_unavailable", Message: "Não foi possível conferir sua conta. Tente novamente.", Status: 503}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", &store.Fault{Code: "auth_unavailable", Message: "Não foi possível conferir sua conta. Tente novamente.", Status: 503}
	}
	var session struct {
		User *struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 16<<10)).Decode(&session) != nil {
		return "", &store.Fault{Code: "auth_unavailable", Message: "Não foi possível conferir sua conta. Tente novamente.", Status: 503}
	}
	if session.User == nil || session.User.ID == "" {
		return "", &store.Fault{Code: "login_required", Message: "Entre na sua conta para continuar a compra.", Status: 401}
	}
	return session.User.ID, nil
}

// Better Auth owns credentials, sessions and OAuth. Go only consumes its
// verified browser identity to enforce checkout ownership in the commerce store.
func (s *Server) registerAccounts(mux *http.ServeMux) {
	target, e := url.Parse(s.AuthURL)
	if e != nil || target.Scheme != "http" || !net.ParseIP(target.Hostname()).IsLoopback() {
		return
	}
	origin, e := url.Parse(s.PublicOrigin)
	if e != nil || origin.Host == "" {
		return
	}
	proxy := &httputil.ReverseProxy{Rewrite: func(r *httputil.ProxyRequest) {
		r.SetURL(target)
		r.Out.Host = origin.Host
		for _, name := range []string{"Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For"} {
			r.Out.Header.Del(name)
		}
		ip, _, _ := net.SplitHostPort(r.In.RemoteAddr)
		r.Out.Header.Set("X-Agent-Store-Client-IP", ip)
	}, ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
		respond(w, 503, map[string]string{"error": "auth_unavailable"})
	}}
	mux.Handle("/api/auth/", proxy)
	mux.Handle("/.well-known/oauth-authorization-server/api/auth", proxy)
	mux.Handle("/.well-known/openid-configuration/api/auth", proxy)
	mux.HandleFunc("GET /api/account/demo-delivery", func(w http.ResponseWriter, r *http.Request) {
		account, e := s.browserAccount(r)
		if e != nil {
			fail(w, e)
			return
		}
		// Stable demo data for every existing or new account, across browsers.
		// Never derive an address or contact from personal account data.
		hash := sha256.Sum256([]byte(account))
		delivery := store.Delivery{FullName: "Cliente de demonstração", Email: "cliente@example.test", PostalCode: "01001000", Street: "Rua da Demonstração", Number: fmt.Sprint(100 + (int(hash[0])*256+int(hash[1]))%900), Complement: "Endereço fictício", Neighborhood: "Centro", City: "São Paulo", State: "SP"}
		respond(w, 200, map[string]any{"demo": true, "delivery": delivery})
	})
	mux.HandleFunc("GET /api/account/checkouts", func(w http.ResponseWriter, r *http.Request) {
		account, e := s.browserAccount(r)
		if e != nil {
			fail(w, e)
			return
		}
		purchases, e := s.Store.AccountPurchases(r.Context(), account)
		if e != nil {
			fail(w, e)
			return
		}
		respond(w, 200, purchases)
	})
	mux.HandleFunc("/api/account/checkouts/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && (r.Method != "POST" || r.Header.Get("Origin") != s.PublicOrigin || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")) {
			respond(w, 403, map[string]string{"error": "csrf_failed"})
			return
		}
		account, e := s.browserAccount(r)
		if e != nil {
			fail(w, e)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/account/checkouts/"), "/")
		action := ""
		if r.Method == "POST" && len(parts) == 2 && (parts[1] == "cancel" || parts[1] == "simulate-payment") {
			action = parts[1]
		} else if r.Method != "GET" || len(parts) != 1 {
			respond(w, 404, map[string]string{"error": "not_found"})
			return
		}
		checkout, e := s.Store.AccountCheckout(r.Context(), parts[0], account, action)
		if e != nil {
			fail(w, e)
			return
		}
		checkout.Token = ""
		respond(w, 200, checkout)
	})
}
