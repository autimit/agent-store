package store

import (
	"context"
	"testing"
)

func TestAccountCheckoutOwnershipAndAtomicIdempotency(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	before := stock(t, s, "aut-oliva-m")
	i := input("aut-oliva-m", 1)
	a, replay, e := s.CreateAccountCheckout(ctx, "same-client-key-0001", i, "account-a")
	if e != nil || replay {
		t.Fatal("account checkout creation failed", e)
	}
	retry, replay, e := s.CreateAccountCheckout(ctx, "same-client-key-0001", i, "account-a")
	if e != nil || !replay || retry.ID != a.ID {
		t.Fatal("account retry changed reservation", e)
	}
	b, replay, e := s.CreateAccountCheckout(ctx, "same-client-key-0001", i, "account-b")
	if e != nil || replay || b.ID == a.ID {
		t.Fatal("accounts shared an idempotency result", e)
	}
	if stock(t, s, "aut-oliva-m") != before-2 {
		t.Fatal("unexpected reserved inventory")
	}
	_, e = s.AccountCheckout(ctx, a.ID, "account-b", "")
	expectCode(t, e, "checkout_not_found")
	_, e = s.AccountCheckout(ctx, a.ID, "", "")
	expectCode(t, e, "unauthorized")
	c, e := s.AccountCheckout(ctx, a.ID, "account-a", "cancel")
	if e != nil || c.Status != "canceled" || c.Token != "" {
		t.Fatal("owned cancellation failed", e)
	}
	if stock(t, s, "aut-oliva-m") != before-1 {
		t.Fatal("cancellation did not release inventory")
	}
}
