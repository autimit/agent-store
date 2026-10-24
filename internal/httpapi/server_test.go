package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"autimit.local/agent-store/internal/store"
)

func testAPI(t *testing.T) http.Handler {
	t.Helper()
	c, err := store.LoadCatalog("../../data/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"), c)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return (&Server{Store: s, ImageDir: "../../data/images"}).Handler()
}
func request(h http.Handler, method, path, body, token, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestHTTPPurchaseContract(t *testing.T) {
	h := testAPI(t)
	body := `{"items":[{"variant_id":"sculpt-bordo-42","quantity":1}],"payment_method":"pix","shipping":{"postal_code":"01001000","service_id":"standard"},"delivery":{"full_name":"Cliente Demo","email":"demo@example.test","postal_code":"01001000","street":"Rua de Teste","number":"100","neighborhood":"Centro","city":"São Paulo","state":"SP"}}`
	w := request(h, "POST", "/api/v1/checkouts", body, "", "api-purchase-key-0001")
	if w.Code != 201 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var c store.Checkout
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	if w.Header().Get("Location") != "/api/v1/checkouts/"+c.ID || c.Token == "" {
		t.Fatal("missing creation contract")
	}
	w = request(h, "GET", "/api/v1/checkouts/"+c.ID, "", "", "")
	if w.Code != 404 {
		t.Fatal("unauthenticated checkout access")
	}
	w = request(h, "POST", "/api/v1/checkouts/"+c.ID+"/simulate-payment", "{}", c.Token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"real_payment":false`) {
		t.Fatalf("payment: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatal("token leaked after creation")
	}
	w = request(h, "POST", "/api/v1/checkouts", body, "", "api-purchase-key-0001")
	if w.Code != 200 || w.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatal("unsafe HTTP retry")
	}
}

func TestAUTShirtCheckoutUsesBRLCatalogPrices(t *testing.T) {
	h := testAPI(t)
	w := request(h, "GET", "/api/v1/products/aut-tshirt", "", "", "")
	if w.Code != 200 {
		t.Fatalf("missing storefront product: %s", w.Body.String())
	}
	var p store.Product
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Name != "AUT T-SHIRT" || len(p.Images) != 6 || len(p.Variants) != 24 {
		t.Fatalf("unexpected shirt catalog: %s, %d images, %d variants", p.Name, len(p.Images), len(p.Variants))
	}
	w = request(h, "POST", "/api/v1/checkouts", `{"items":[{"variant_id":"aut-oliva-g","quantity":2}],"payment_method":"pix","shipping":{"postal_code":"01001000","service_id":"standard"},"delivery":{"full_name":"Cliente Demo","email":"demo@example.test","postal_code":"01001000","street":"Rua de Teste","number":"100","neighborhood":"Centro","city":"São Paulo","state":"SP"}}`, "", "aut-shirt-checkout-0001")
	if w.Code != 201 {
		t.Fatalf("checkout: %s", w.Body.String())
	}
	var c store.Checkout
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	if c.Quote.Currency != "BRL" || c.Quote.Total != 13490 || c.Quote.Shipping != 1490 || c.Quote.Items[0].Name != "AUT T-SHIRT" || c.Quote.Items[0].Size != "G" {
		t.Fatalf("checkout differs from the storefront: %+v", c.Quote)
	}
}
func TestRejectsClientPricesUnknownFieldsAndCrossOrigin(t *testing.T) {
	h := testAPI(t)
	for _, body := range []string{`{"items":[{"variant_id":"sculpt-bordo-42","quantity":1,"unit_price_cents":1}]}`, `{"items":[{"variant_id":"sculpt-bordo-42","quantity":1}]} {}`} {
		w := request(h, "POST", "/api/v1/quotes", body, "", "")
		if w.Code != 400 {
			t.Fatalf("accepted invalid body %s", body)
		}
	}
	r := httptest.NewRequest("POST", "/api/v1/quotes", strings.NewReader(`{"items":[]}`))
	r.Header.Set("Origin", "https://other.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin write accepted")
	}
}
func TestPublicDiscoveryAndAssets(t *testing.T) {
	h := testAPI(t)
	for _, path := range []string{"/", "/produto/aut-tshirt", "/agents", "/openapi.json", "/llms.txt", "/api/v1/products", "/api/v1/store", "/api/v1/images/sculpt-oliva", "/assets/store.css", "/assets/store.js", "/assets/inter-regular-latin.woff2", "/assets/t-shirt.png"} {
		w := request(h, "GET", path, "", "", "")
		if w.Code != 200 {
			t.Errorf("%s: %d", path, w.Code)
		}
		if w.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
			t.Error("demo indexing not blocked")
		}
	}
	w := request(h, "GET", "/", "", "", "")
	if strings.Contains(w.Body.String(), "__PRODUCT_JSON_LD__") || strings.Contains(w.Body.String(), "sculpt-bordo") {
		t.Fatal("old catalog metadata leaked into the new storefront")
	}
	w = request(h, "GET", "/api/v1/products", "", "", "")
	if strings.Contains(w.Body.String(), `"arquivo"`) || strings.Contains(w.Body.String(), "../../") {
		t.Fatal("internal file path leak")
	}
}

func TestShippingHTTPContractRejectsClientRates(t *testing.T) {
	h := testAPI(t)
	w := request(h, "POST", "/api/v1/shipping-quotes", `{"items":[{"variant_id":"aut-oliva-m","quantity":1}],"postal_code":"01001-000"}`, "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"price_cents":1490`) {
		t.Fatalf("shipping options: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "POST", "/api/v1/quotes", `{"items":[{"variant_id":"aut-oliva-m","quantity":1}],"shipping":{"postal_code":"01001000","service_id":"express"}}`, "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"total_cents":8490`) {
		t.Fatalf("shipping total: %d %s", w.Code, w.Body.String())
	}
	w = request(h, "POST", "/api/v1/quotes", `{"items":[{"variant_id":"aut-oliva-m","quantity":1}],"shipping":{"postal_code":"01001000","service_id":"express","price_cents":0}}`, "", "")
	if w.Code != 400 {
		t.Fatal("client-selected shipping price was accepted")
	}
	w = request(h, "POST", "/api/v1/checkouts", `{"items":[{"variant_id":"aut-oliva-m","quantity":1}],"payment_method":"pix"}`, "", "checkout-without-shipping")
	if w.Code != 400 || !strings.Contains(w.Body.String(), "shipping_required") {
		t.Fatal("checkout bypassed shipping requirements")
	}
}
