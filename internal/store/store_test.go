package store

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	c, err := LoadCatalog("../../data/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "store.db"), c)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func stock(t *testing.T, s *Store, id string) int {
	t.Helper()
	p, err := s.Products(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range p {
		for _, v := range p.Variants {
			if v.ID == id {
				return v.Available
			}
		}
	}
	t.Fatal("missing variant")
	return -1
}
func input(id string, n int) CheckoutInput {
	return CheckoutInput{Items: []ItemInput{{id, n}}, PaymentMethod: "pix", Shipping: &ShippingSelection{PostalCode: "01001000", ServiceID: "standard"}, Delivery: &Delivery{FullName: "Cliente Demo", Email: "demo@example.test", PostalCode: "01001000", Street: "Rua de Teste", Number: "100", Neighborhood: "Centro", City: "São Paulo", State: "SP"}}
}
func expectCode(t *testing.T, err error, code string) {
	t.Helper()
	var f *Fault
	if !errors.As(err, &f) || f.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestCheckoutReplayPaymentAndRestart(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "sculpt-bordo-42"
	before := stock(t, s, id)
	c, replay, err := s.CreateCheckout(ctx, "repeatable-order-0001", input(id, 1))
	if err != nil || replay {
		t.Fatalf("create: %v", err)
	}
	if stock(t, s, id) != before-1 {
		t.Fatal("stock not reserved")
	}
	again, replay, err := s.CreateCheckout(ctx, "repeatable-order-0001", input(id, 1))
	if err != nil || !replay || again.ID != c.ID || again.Token != c.Token {
		t.Fatalf("unsafe replay: %+v %v", again, err)
	}
	if stock(t, s, id) != before-1 {
		t.Fatal("replay reserved twice")
	}
	_, _, err = s.CreateCheckout(ctx, "repeatable-order-0001", input(id, 2))
	expectCode(t, err, "idempotency_conflict")
	_, err = s.Checkout(ctx, c.ID, "wrong-token", "simulate-payment")
	expectCode(t, err, "checkout_not_found")
	paid, err := s.Checkout(ctx, c.ID, c.Token, "simulate-payment")
	if err != nil || paid.OrderID == "" || paid.RealPayment || paid.PaymentStatus != "simulated_approved" {
		t.Fatalf("completion: %+v %v", paid, err)
	}
	duplicate, err := s.Checkout(ctx, c.ID, c.Token, "simulate-payment")
	if err != nil || duplicate.OrderID != paid.OrderID {
		t.Fatal("duplicate order on repeated payment")
	}
	_, err = s.Checkout(ctx, c.ID, c.Token, "cancel")
	expectCode(t, err, "checkout_closed")
	if stock(t, s, id) != before-1 {
		t.Fatal("completed purchase restocked")
	}
}

func TestLastUnitConcurrentCheckouts(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "sculpt-bordo-44"
	if stock(t, s, id) != 1 {
		t.Fatal("fixture must have one unit")
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"concurrent-buyer-0001", "concurrent-buyer-0002"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			_, _, err := s.CreateCheckout(ctx, key, input(id, 1))
			results <- err
		}(key)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			expectCode(t, err, "out_of_stock")
		}
	}
	if success != 1 || stock(t, s, id) != 0 {
		t.Fatalf("oversell: successes=%d", success)
	}
}

func TestCancelAndExpirationReleaseExactlyOnce(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "sculpt-bordo-42"
	before := stock(t, s, id)
	c, _, err := s.CreateCheckout(ctx, "cancel-checkout-0001", input(id, 1))
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err = s.Checkout(ctx, c.ID, c.Token, "cancel"); err != nil {
			t.Fatal(err)
		}
	}
	if stock(t, s, id) != before {
		t.Fatal("cancel duplicated or lost stock")
	}
	c, _, err = s.CreateCheckout(ctx, "expire-checkout-0001", input(id, 1))
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return c.ExpiresAt.Add(time.Second) }
	if stock(t, s, id) != before || stock(t, s, id) != before {
		t.Fatal("expiration did not release exactly once")
	}
	_, err = s.Checkout(ctx, c.ID, c.Token, "simulate-payment")
	expectCode(t, err, "checkout_closed")
	expired, replay, err := s.CreateCheckout(ctx, "expire-checkout-0001", input(id, 1))
	if err != nil || !replay || expired.Status != "expired" {
		t.Fatalf("expired replay: %+v %v", expired, err)
	}
}

func TestFailedMultiItemCheckoutRollsBackReservation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "sculpt-bordo-42"
	before := stock(t, s, id)
	i := input(id, 1)
	i.Items = []ItemInput{{id, 1}, {"sculpt-oliva-42", 1}}
	_, _, err := s.CreateCheckout(ctx, "rollback-checkout-0001", i)
	expectCode(t, err, "out_of_stock")
	if stock(t, s, id) != before {
		t.Fatal("partial reservation after failure")
	}
	q, err := s.Quote(ctx, []ItemInput{{id, 1}, {id, 1}})
	if err != nil || len(q.Items) != 1 || q.Total != 57980 {
		t.Fatalf("server quote: %+v %v", q, err)
	}
	if stock(t, s, id) != before {
		t.Fatal("quote must not reserve")
	}
}

func TestPersistentInventoryAndCheckout(t *testing.T) {
	ctx := context.Background()
	c, err := LoadCatalog("../../data/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "persist.db")
	s, err := Open(ctx, path, c)
	if err != nil {
		t.Fatal(err)
	}
	checkout, _, err := s.CreateCheckout(ctx, "persistent-order-0001", input("sculpt-bordo-44", 1))
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path, c)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if stock(t, s, "sculpt-bordo-44") != 0 {
		t.Fatal("restart reset reserved inventory")
	}
	got, err := s.Checkout(ctx, checkout.ID, checkout.Token, "")
	if err != nil || got.ID != checkout.ID || got.Status != "open" {
		t.Fatalf("lost checkout: %+v %v", got, err)
	}
}
