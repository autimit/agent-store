package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestShippingRatesAndQuoteDoNotReserveStock(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "aut-oliva-m"
	before := stock(t, s, id)
	items := []ItemInput{{VariantID: id, Quantity: 1}}
	_, err := s.ShippingQuotes(ctx, items, "123")
	expectCode(t, err, "invalid_postal_code")
	quotes, err := s.ShippingQuotes(ctx, items, "01001-000")
	if err != nil {
		t.Fatal(err)
	}
	if quotes.PostalCode != "01001000" || len(quotes.Options) != 2 || quotes.Options[0].PriceCents != 1490 || !quotes.Demo {
		t.Fatalf("unexpected shipping quote: %+v", quotes)
	}
	for _, service := range []struct {
		id    string
		total int64
	}{{"standard", 7490}, {"express", 8490}} {
		q, err := s.QuoteWithShipping(ctx, QuoteInput{Items: items, Shipping: &ShippingSelection{PostalCode: "01001-000", ServiceID: service.id}})
		if err != nil || q.Total != service.total || q.ShippingRequired || q.ShippingOption.ID != service.id {
			t.Fatalf("quote: %+v %v", q, err)
		}
	}
	q, err := s.Quote(ctx, items)
	if err != nil || !q.ShippingRequired || q.ShippingOption != nil {
		t.Fatal("bare quote must indicate shipping pending")
	}
	if stock(t, s, id) != before {
		t.Fatal("shipping estimate or quote reserved stock")
	}
}

func TestShippingAndDeliveryCannotBeSkippedOrMismatched(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id := "aut-oliva-m"
	before := stock(t, s, id)
	for _, scenario := range []struct {
		change func(*CheckoutInput)
		code   string
	}{
		{func(i *CheckoutInput) { i.Shipping = nil }, "shipping_required"},
		{func(i *CheckoutInput) { i.Shipping.ServiceID = "free" }, "invalid_shipping_service"},
		{func(i *CheckoutInput) { i.Delivery = nil }, "delivery_required"},
		{func(i *CheckoutInput) { i.Delivery.PostalCode = "90000000" }, "postal_code_mismatch"},
		{func(i *CheckoutInput) { i.Delivery.Email = "invalid" }, "invalid_email"},
		{func(i *CheckoutInput) { i.Delivery.State = "XX" }, "invalid_state"},
	} {
		i := input(id, 1)
		scenario.change(&i)
		_, _, err := s.CreateCheckout(ctx, "invalid-delivery-test-001", i)
		expectCode(t, err, scenario.code)
	}
	if stock(t, s, id) != before {
		t.Fatal("invalid shipping/delivery consumed stock")
	}
	i := input(id, 1)
	i.Shipping.ServiceID = "express"
	i.Shipping.PostalCode = "01001-000"
	i.Delivery.FullName = "  Cliente  Demo  "
	i.Delivery.State = "sp"
	c, _, err := s.CreateCheckout(ctx, "valid-express-checkout-001", i)
	if err != nil {
		t.Fatal(err)
	}
	if c.Quote.Total != 8490 || c.Delivery.FullName != "Cliente Demo" || c.Delivery.State != "SP" {
		t.Fatalf("shipping/address not normalized: %+v", c)
	}
	i.Delivery.Number = "200"
	_, _, err = s.CreateCheckout(ctx, "valid-express-checkout-001", i)
	expectCode(t, err, "idempotency_conflict")
	got, err := s.Checkout(ctx, c.ID, c.Token, "")
	if err != nil || got.Delivery.Number != "100" || got.Quote.ShippingOption.ID != "express" {
		t.Fatal("shipping/delivery not persisted")
	}
}

func TestMigratesLegacyCheckoutWithoutLosingIt(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE checkouts (id TEXT PRIMARY KEY,token TEXT NOT NULL,idem_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,state TEXT NOT NULL,payment_method TEXT NOT NULL,quote TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,order_id TEXT NOT NULL DEFAULT '')`)
	if err != nil {
		t.Fatal(err)
	}
	q, _ := json.Marshal(Quote{Items: []Line{}, Currency: "BRL", Demo: true})
	_, err = db.Exec(`INSERT INTO checkouts VALUES(?,?,?,?,?,?,?,?,?,?)`, "legacy-id", "legacy-token", "legacy-key", "hash", "completed", "pix", string(q), time.Now().Unix(), time.Now().Add(time.Hour).Unix(), "legacy-order")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	catalog, err := LoadCatalog("../../data/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(ctx, path, catalog)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Checkout(ctx, "legacy-id", "legacy-token", "")
	if err != nil || c.OrderID != "legacy-order" || c.Delivery != nil {
		t.Fatalf("legacy data changed: %+v %v", c, err)
	}
	created, _, err := s.CreateCheckout(ctx, "new-checkout-after-migration", input("aut-gelo-m", 1))
	if err != nil || created.Delivery == nil {
		t.Fatalf("new delivery after migration: %v", err)
	}
	s.Close()
	s, err = Open(ctx, path, catalog)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, err := s.Checkout(ctx, created.ID, created.Token, "")
	if err != nil || got.Delivery.Email != "demo@example.test" {
		t.Fatal("address lost after reopening migrated database")
	}
}
