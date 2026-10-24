package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"autimit.local/agent-store/internal/store"
	"autimit.local/agent-store/web"
)

type Server struct {
	Store    *store.Store
	ImageDir string
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		io.WriteString(w, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#212b24"/><path d="M8 23 16 7l8 16h-5l-3-6-3 6" fill="#dbeaaf"/></svg>`)
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "demo": true})
	})
	mux.HandleFunc("GET /api/v1/store", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.Store.Metadata()) })
	mux.HandleFunc("GET /api/v1/products", s.products)
	mux.HandleFunc("GET /api/v1/products/{id}", s.product)
	mux.HandleFunc("GET /api/v1/variants/{id}/availability", s.availability)
	mux.HandleFunc("GET /api/v1/images/{id}", s.image)
	mux.HandleFunc("POST /api/v1/quotes", s.quote)
	mux.HandleFunc("POST /api/v1/shipping-quotes", s.shippingQuotes)
	mux.HandleFunc("GET /produto/{id}", s.productPage)
	mux.HandleFunc("POST /api/v1/checkouts", s.createCheckout)
	mux.HandleFunc("GET /api/v1/checkouts/{id}", s.checkout)
	mux.HandleFunc("POST /api/v1/checkouts/{id}/simulate-payment", s.checkout)
	mux.HandleFunc("POST /api/v1/checkouts/{id}/cancel", s.checkout)
	mux.HandleFunc("GET /openapi.json", func(w http.ResponseWriter, r *http.Request) {
		data, _ := web.Files.ReadFile("openapi.json")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(data)
	})
	mux.HandleFunc("GET /llms.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, "# Agent Store\n\nLoja fictícia da Autimit. Todos os produtos, estoques, pedidos e pagamentos são demonstrativos. Nenhuma cobrança ou entrega real.\n\n## Interface HTTP\n- [Contrato OpenAPI 3.1](/openapi.json)\n- [Identidade e políticas](/api/v1/store)\n- [Catálogo e variantes](/api/v1/products)\n\nUse GET /api/v1/variants/{id}/availability para consultar estoque. POST /api/v1/shipping-quotes recebe items e postal_code e retorna fretes e prazos simulados, sem reservar. POST /api/v1/quotes aceita shipping com postal_code e service_id para incluir o frete no total. Ao criar checkout, inclua shipping e delivery (contato e endereço fictícios). O CEP do endereço deve coincidir com o da cotação. Não envie preços calculados pelo cliente. POST /api/v1/quotes calcula valores sem reserva. POST /api/v1/checkouts reserva estoque por 15 minutos e requer Idempotency-Key. A criação retorna access_token; envie-o como Authorization: Bearer para ler, cancelar ou simular pagamento desse checkout. Guarde a chave de idempotência até receber resposta para repetir com segurança.\n\nPeça confirmação do cliente antes de reservar estoque. Simular pagamento só é permitido com autorização explícita para a demonstração. Nunca afirme que houve pagamento real, entrega real ou compatibilidade com protocolos que não estão implementados. Este arquivo é orientação textual, não um protocolo de descoberta ou uma autorização. Não há servidor MCP ou A2A nesta entrega.\n")
	})
	mux.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		io.WriteString(w, "User-agent: *\nDisallow: /\n")
	})
	mux.HandleFunc("GET /{$}", s.index)
	mux.HandleFunc("GET /agents", func(w http.ResponseWriter, r *http.Request) { serveEmbedded(w, r, "agents.html") })
	assets, _ := fs.Sub(web.Files, ".")
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(assets))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, &store.Fault{Code: "not_found", Message: "Rota não encontrada.", Status: 404})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				fail(w, &store.Fault{Code: "cross_origin_denied", Message: "Use a interface da própria loja.", Status: 403})
				return
			}
			origin := r.Header.Get("Origin")
			if origin != "" && origin != "http://"+r.Host && origin != "https://"+r.Host {
				fail(w, &store.Fault{Code: "cross_origin_denied", Message: "Origem não autorizada.", Status: 403})
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		mux.ServeHTTP(w, r.WithContext(ctx))
	})
}
func serveEmbedded(w http.ResponseWriter, r *http.Request, name string) {
	data, err := web.Files.ReadFile(name)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}
func (s *Server) index(w http.ResponseWriter, r *http.Request) {
	serveEmbedded(w, r, "index.html")
}
func (s *Server) products(w http.ResponseWriter, r *http.Request) {
	p, err := s.Store.Products(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, map[string]any{"products": p, "demo": true, "currency": "BRL", "stock_checked_at": time.Now().UTC()})
}
func (s *Server) product(w http.ResponseWriter, r *http.Request) {
	products, err := s.Store.Products(r.Context(), "")
	if err != nil {
		fail(w, err)
		return
	}
	for _, p := range products {
		if p.ID == r.PathValue("id") {
			respond(w, 200, p)
			return
		}
	}
	fail(w, &store.Fault{Code: "product_not_found", Message: "Produto não encontrado.", Status: 404})
}
func (s *Server) availability(w http.ResponseWriter, r *http.Request) {
	n := 1
	var err error
	if raw := r.URL.Query().Get("quantity"); raw != "" {
		n, err = strconv.Atoi(raw)
	}
	if err != nil || n < 1 || n > 10 {
		fail(w, &store.Fault{Code: "invalid_quantity", Message: "Quantidade deve ser de 1 a 10.", Status: 400})
		return
	}
	products, err := s.Store.Products(r.Context(), "")
	if err != nil {
		fail(w, err)
		return
	}
	for _, p := range products {
		for _, v := range p.Variants {
			if v.ID == r.PathValue("id") {
				respond(w, 200, map[string]any{"variant_id": v.ID, "available": v.Available, "requested": n, "can_fulfill": v.Available >= n, "unit_price_cents": v.PriceCents, "subtotal_cents": int64(n) * v.PriceCents, "currency": "BRL", "demo": true, "reserved": false})
				return
			}
		}
	}
	fail(w, &store.Fault{Code: "variant_not_found", Message: "Variante não encontrada.", Status: 404})
}
func (s *Server) image(w http.ResponseWriter, r *http.Request) {
	file, ok := s.Store.ImageFile(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	root, err := filepath.EvalSymlinks(s.ImageDir)
	if err != nil {
		fail(w, err)
		return
	}
	path, err := filepath.EvalSymlinks(filepath.Join(root, file))
	if err != nil {
		fail(w, err)
		return
	}
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, path)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		fail(w, &store.Fault{Code: "unsupported_media_type", Message: "Envie Content-Type: application/json.", Status: 415})
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, &store.Fault{Code: "invalid_json", Message: "JSON inválido ou campos não reconhecidos.", Status: 400})
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		fail(w, &store.Fault{Code: "invalid_json", Message: "Envie apenas um objeto JSON.", Status: 400})
		return false
	}
	return true
}
func (s *Server) quote(w http.ResponseWriter, r *http.Request) {
	var body store.QuoteInput
	if !decode(w, r, &body) {
		return
	}
	q, err := s.Store.QuoteWithShipping(r.Context(), body)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, q)
}
func (s *Server) createCheckout(w http.ResponseWriter, r *http.Request) {
	var input store.CheckoutInput
	if !decode(w, r, &input) {
		return
	}
	c, replay, err := s.Store.CreateCheckout(r.Context(), r.Header.Get("Idempotency-Key"), input)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/checkouts/"+c.ID)
	status := 201
	if replay {
		status = 200
		w.Header().Set("Idempotency-Replayed", "true")
	}
	respond(w, status, c)
}
func (s *Server) checkout(w http.ResponseWriter, r *http.Request) {
	action := ""
	if r.Method == "POST" {
		if strings.HasSuffix(r.URL.Path, "/simulate-payment") {
			action = "simulate-payment"
		} else {
			action = "cancel"
		}
		var input struct{}
		if !decode(w, r, &input) {
			return
		}
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == r.Header.Get("Authorization") {
		token = ""
	}
	c, err := s.Store.Checkout(r.Context(), r.PathValue("id"), token, action)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, c)
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, err error) {
	var f *store.Fault
	if errors.As(err, &f) {
		respond(w, f.Status, map[string]any{"error": map[string]string{"code": f.Code, "message": f.Message}, "demo": true})
		return
	}
	slog.Error("falha interna da Agent Store", "error", err)
	respond(w, 500, map[string]any{"error": map[string]string{"code": "internal_error", "message": "Não foi possível concluir. Tente novamente."}, "demo": true})
}

func (s *Server) shippingQuotes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Items      []store.ItemInput `json:"items"`
		PostalCode string            `json:"postal_code"`
	}
	if !decode(w, r, &body) {
		return
	}
	quote, err := s.Store.ShippingQuotes(r.Context(), body.Items, body.PostalCode)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, quote)
}
func (s *Server) productPage(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("id") != "aut-tshirt" {
		http.NotFound(w, r)
		return
	}
	serveEmbedded(w, r, "product.html")
}
