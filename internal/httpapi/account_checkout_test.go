package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"autimit.local/agent-store/internal/store"
)

const accountCart = `{"items":[{"variant_id":"aut-oliva-m","quantity":1}],"payment_method":"pix","shipping":{"postal_code":"01001000","service_id":"standard"},"delivery":{"full_name":"Cliente de Teste","email":"cliente@example.test","postal_code":"01001000","street":"Rua de Teste","number":"100","neighborhood":"Centro","city":"São Paulo","state":"SP"}}`

func asAccount(h http.Handler, method, path, body, account, expected, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://store.test"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://store.test")
	r.Header.Set("Idempotency-Key", "account-api-key-00001")
	r.Header.Set("X-Checkout-Account", expected)
	if account != "" {
		r.Header.Set("Cookie", "test_session="+account)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestStorefrontCheckoutRequiresAccountAndProtectsOwnership(t *testing.T) {
	h := testAPI(t)
	for _, account := range []string{"", "expired"} {
		w := asAccount(h, "POST", "/api/v1/checkouts", accountCart, account, "account-a", "")
		if w.Code != 401 {
			t.Fatalf("guest/expired create: %d", w.Code)
		}
	}
	w := asAccount(h, "POST", "/api/v1/checkouts", accountCart, "provider-down", "account-a", "")
	if w.Code != 503 {
		t.Fatalf("provider outage must not create guest: %d", w.Code)
	}
	w = asAccount(h, "POST", "/api/v1/checkouts", accountCart, "account-b", "account-a", "")
	if w.Code != 403 {
		t.Fatalf("account switch accepted: %d", w.Code)
	}
	w = asAccount(h, "POST", "/api/v1/checkouts", accountCart, "account-a", "account-a", "")
	if w.Code != 201 {
		t.Fatalf("owned creation: %d %s", w.Code, w.Body.String())
	}
	var checkout store.Checkout
	if e := json.Unmarshal(w.Body.Bytes(), &checkout); e != nil {
		t.Fatal(e)
	}
	replay := asAccount(h, "POST", "/api/v1/checkouts", accountCart, "account-a", "account-a", "")
	if replay.Code != 200 {
		t.Fatal("owned replay failed")
	}
	var retried store.Checkout
	_ = json.Unmarshal(replay.Body.Bytes(), &retried)
	if retried.ID != checkout.ID {
		t.Fatal("replay created another reservation")
	}
	for _, account := range []string{"", "account-b"} {
		want := 404
		if account == "" {
			want = 401
		}
		for _, action := range []string{"", "/cancel", "/simulate-payment"} {
			method := "GET"
			body := ""
			if action != "" {
				method = "POST"
				body = "{}"
			}
			w = asAccount(h, method, "/api/v1/checkouts/"+checkout.ID+action, body, account, account, checkout.Token)
			if w.Code != want {
				t.Fatalf("token bypass for account %q action %q: %d", account, action, w.Code)
			}
		}
		w = asAccount(h, "GET", "/api/account/checkouts/"+checkout.ID, "", account, account, "")
		if w.Code != want {
			t.Fatalf("review exposed another account: %d", w.Code)
		}
	}
	w = asAccount(h, "GET", "/api/account/checkouts", "", "account-b", "", "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal("account B lists account A purchase")
	}
	w = asAccount(h, "GET", "/api/account/checkouts", "", "account-a", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), checkout.ID) || strings.Contains(w.Body.String(), "access_token") || strings.Contains(w.Body.String(), "Cliente de Teste") {
		t.Fatal("account purchase summary missing or leaking details")
	}
	w = asAccount(h, "POST", "/api/account/checkouts/"+checkout.ID+"/simulate-payment", "{}", "account-a", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"completed"`) {
		t.Fatalf("same account review failed: %d", w.Code)
	}
}

func TestDemoDeliveryIsStableAndRequiresVerifiedAccount(t *testing.T) {
	h := testAPI(t)
	for _, account := range []string{"", "expired", "provider-down"} {
		w := asAccount(h, "GET", "/api/account/demo-delivery", "", account, "", "")
		want := 401
		if account == "provider-down" {
			want = 503
		}
		if w.Code != want {
			t.Fatalf("demo address session %q: %d", account, w.Code)
		}
	}
	a := asAccount(h, "GET", "/api/account/demo-delivery", "", "account-a", "account-b", "")
	b := asAccount(h, "GET", "/api/account/demo-delivery?account=account-b", "", "account-a", "", "")
	if a.Code != 200 || a.Body.String() != b.Body.String() {
		t.Fatal("default changed across requests or accepted unverified account selector")
	}
	var value struct {
		Demo     bool           `json:"demo"`
		Delivery store.Delivery `json:"delivery"`
	}
	if e := json.Unmarshal(a.Body.Bytes(), &value); e != nil {
		t.Fatal(e)
	}
	if !value.Demo || value.Delivery.Email != "cliente@example.test" || value.Delivery.Street != "Rua da Demonstração" {
		t.Fatal("must use fictitious delivery data")
	}
	checkout := store.CheckoutInput{}
	if e := json.Unmarshal([]byte(accountCart), &checkout); e != nil {
		t.Fatal(e)
	}
	checkout.Delivery = &value.Delivery
	body, _ := json.Marshal(checkout)
	w := asAccount(h, "POST", "/api/v1/checkouts", string(body), "account-a", "account-a", "")
	if w.Code != 201 {
		t.Fatalf("default cannot complete delivery validation: %d %s", w.Code, w.Body.String())
	}
}
