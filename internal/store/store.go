package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Fault struct {
	Code    string
	Message string
	Status  int
}

func (e *Fault) Error() string                     { return e.Message }
func fault(code, message string, status int) error { return &Fault{code, message, status} }

type Store struct {
	db      *sql.DB
	catalog Catalog
	now     func() time.Time
}
type ItemInput struct {
	VariantID string `json:"variant_id"`
	Quantity  int    `json:"quantity"`
}
type CheckoutInput struct {
	Items         []ItemInput        `json:"items"`
	PaymentMethod string             `json:"payment_method"`
	Shipping      *ShippingSelection `json:"shipping"`
	Delivery      *Delivery          `json:"delivery"`
}
type Line struct {
	VariantID  string `json:"variant_id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Size       string `json:"size"`
	ImageURL   string `json:"image_url"`
	Quantity   int    `json:"quantity"`
	UnitCents  int64  `json:"unit_price_cents"`
	TotalCents int64  `json:"total_cents"`
}
type Quote struct {
	Items            []Line          `json:"items"`
	Subtotal         int64           `json:"subtotal_cents"`
	Shipping         int64           `json:"shipping_cents"`
	Total            int64           `json:"total_cents"`
	Currency         string          `json:"currency"`
	Demo             bool            `json:"demo"`
	ShippingRequired bool            `json:"shipping_required"`
	ShippingOption   *ShippingOption `json:"shipping_option,omitempty"`
	PostalCode       string          `json:"postal_code,omitempty"`
}
type Checkout struct {
	ID            string    `json:"id"`
	Token         string    `json:"access_token,omitempty"`
	Status        string    `json:"status"`
	PaymentMethod string    `json:"payment_method"`
	PaymentStatus string    `json:"payment_status"`
	Quote         Quote     `json:"quote"`
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     time.Time `json:"expires_at"`
	OrderID       string    `json:"order_id,omitempty"`
	RealPayment   bool      `json:"real_payment"`
	Delivery      *Delivery `json:"delivery,omitempty"`
}

func Open(ctx context.Context, path string, catalog Catalog) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, catalog: catalog, now: time.Now}
	_, err = db.ExecContext(ctx, `PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
	CREATE TABLE IF NOT EXISTS inventory (variant_id TEXT PRIMARY KEY, available INTEGER NOT NULL CHECK(available>=0));
	CREATE TABLE IF NOT EXISTS checkouts (id TEXT PRIMARY KEY, token TEXT NOT NULL, idem_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, state TEXT NOT NULL, payment_method TEXT NOT NULL, quote TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, order_id TEXT NOT NULL DEFAULT '');
	CREATE INDEX IF NOT EXISTS checkout_expiry ON checkouts(state, expires_at);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	columns, err := db.QueryContext(ctx, "PRAGMA table_info(checkouts)")
	if err != nil {
		db.Close()
		return nil, err
	}
	hasDelivery, hasOwner := false, false
	for columns.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue any
		if err = columns.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			columns.Close()
			db.Close()
			return nil, err
		}
		if name == "delivery" {
			hasDelivery = true
		}
		if name == "account_id" {
			hasOwner = true
		}
	}
	err = columns.Err()
	columns.Close()
	if err != nil {
		db.Close()
		return nil, err
	}
	if !hasDelivery {
		if _, err = db.ExecContext(ctx, "ALTER TABLE checkouts ADD COLUMN delivery TEXT NOT NULL DEFAULT ''"); err != nil {
			db.Close()
			return nil, err
		}
	}
	if !hasOwner {
		if _, err = db.ExecContext(ctx, "ALTER TABLE checkouts ADD COLUMN account_id TEXT NOT NULL DEFAULT ''"); err != nil {
			db.Close()
			return nil, err
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		db.Close()
		return nil, err
	}
	defer tx.Rollback()
	for _, p := range catalog.Products {
		for _, v := range p.Variants {
			if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO inventory(variant_id, available) VALUES (?,?)`, v.ID, v.Available); err != nil {
				tx.Rollback()
				db.Close()
				return nil, err
			}
		}
	}
	if err = tx.Commit(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Metadata() map[string]any {
	return map[string]any{"name": s.catalog.Name, "demo": true, "currency": "BRL", "checkout_mode": "simulation", "shipping": "Frete padrão e expresso por CEP, com valores e prazos fictícios. Sem entrega real.", "reservation_minutes": 15, "payment_methods": []string{"pix", "card"}, "policies": map[string]string{"product": "Produto conceitual. Marca, materiais e desempenho não são declarados.", "returns": "Não há venda ou entrega real nesta demonstração. A política comercial deverá ser definida antes de uma operação real."}}
}

func (s *Store) expire(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT id,quote FROM checkouts WHERE state='open' AND expires_at<=?`, s.now().Unix())
	if err != nil {
		return err
	}
	type expired struct {
		id string
		q  Quote
	}
	var list []expired
	for rows.Next() {
		var id, raw string
		if err = rows.Scan(&id, &raw); err != nil {
			rows.Close()
			return err
		}
		var q Quote
		if err = json.Unmarshal([]byte(raw), &q); err != nil {
			rows.Close()
			return err
		}
		list = append(list, expired{id, q})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, x := range list {
		if err = s.release(ctx, tx, x.q); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE checkouts SET state='expired' WHERE id=?`, x.id); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) release(ctx context.Context, tx *sql.Tx, q Quote) error {
	for _, line := range q.Items {
		if _, err := tx.ExecContext(ctx, `UPDATE inventory SET available=available+? WHERE variant_id=?`, line.Quantity, line.VariantID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Products(ctx context.Context, query string) ([]Product, error) {
	if len([]rune(query)) > 100 {
		return nil, fault("invalid_query", "Use até 100 caracteres na busca.", 400)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = s.expire(ctx, tx); err != nil {
		return nil, err
	}
	result := []Product{}
	for _, p := range s.catalog.Products {
		if !matches(p, query) {
			continue
		}
		copyP := p
		copyP.Variants = append([]Variant(nil), p.Variants...)
		for i := range copyP.Variants {
			if err = tx.QueryRowContext(ctx, `SELECT available FROM inventory WHERE variant_id=?`, copyP.Variants[i].ID).Scan(&copyP.Variants[i].Available); err != nil {
				return nil, err
			}
		}
		result = append(result, copyP)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
func (s *Store) Variant(id string) (Product, Variant, bool) {
	for _, p := range s.catalog.Products {
		for _, v := range p.Variants {
			if v.ID == id {
				return p, v, true
			}
		}
	}
	return Product{}, Variant{}, false
}
func (s *Store) ImageFile(id string) (string, bool) {
	for _, p := range s.catalog.Products {
		for _, img := range p.Images {
			if img.ID == id {
				return img.File, true
			}
		}
	}
	return "", false
}

func normalizeItems(items []ItemInput) ([]ItemInput, error) {
	if len(items) < 1 || len(items) > 10 {
		return nil, fault("invalid_items", "Informe de 1 a 10 itens.", 400)
	}
	counts := map[string]int{}
	total := 0
	for _, i := range items {
		if strings.TrimSpace(i.VariantID) == "" || len(i.VariantID) > 100 || i.Quantity < 1 || i.Quantity > 10 {
			return nil, fault("invalid_items", "Cada item precisa de uma variante e quantidade de 1 a 10.", 400)
		}
		counts[i.VariantID] += i.Quantity
		total += i.Quantity
	}
	if total > 10 {
		return nil, fault("quantity_limit", "O limite da demonstração é de 10 unidades por checkout.", 400)
	}
	clean := make([]ItemInput, 0, len(counts))
	for id, n := range counts {
		clean = append(clean, ItemInput{id, n})
	}
	sort.Slice(clean, func(i, j int) bool { return clean[i].VariantID < clean[j].VariantID })
	return clean, nil
}
func (s *Store) quote(ctx context.Context, tx *sql.Tx, items []ItemInput, reserve bool) (Quote, error) {
	q := Quote{Items: []Line{}, Currency: "BRL", Demo: true}
	for _, i := range items {
		p, v, ok := s.Variant(i.VariantID)
		if !ok {
			return q, fault("variant_not_found", "Variante não encontrada.", 404)
		}
		var available int
		if err := tx.QueryRowContext(ctx, `SELECT available FROM inventory WHERE variant_id=?`, v.ID).Scan(&available); err != nil {
			return q, err
		}
		if available < i.Quantity {
			return q, fault("out_of_stock", fmt.Sprintf("%s, %s, tamanho %s: há %d unidade(s) disponível(is).", p.Name, v.Color, v.Size, available), 409)
		}
		if reserve {
			r, err := tx.ExecContext(ctx, `UPDATE inventory SET available=available-? WHERE variant_id=? AND available>=?`, i.Quantity, v.ID, i.Quantity)
			if err != nil {
				return q, err
			}
			n, _ := r.RowsAffected()
			if n != 1 {
				return q, fault("out_of_stock", "O estoque mudou. Atualize seu carrinho.", 409)
			}
		}
		line := Line{v.ID, p.Name, v.Color, v.Size, "/api/v1/images/" + v.ImageID, i.Quantity, v.PriceCents, v.PriceCents * int64(i.Quantity)}
		q.Items = append(q.Items, line)
		q.Subtotal += line.TotalCents
	}
	q.Total = q.Subtotal + q.Shipping
	q.ShippingRequired = true
	return q, nil
}
func (s *Store) Quote(ctx context.Context, items []ItemInput) (Quote, error) {
	return s.QuoteWithShipping(ctx, QuoteInput{Items: items})
}
func (s *Store) QuoteWithShipping(ctx context.Context, input QuoteInput) (Quote, error) {
	items, err := normalizeItems(input.Items)
	if err != nil {
		return Quote{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Quote{}, err
	}
	defer tx.Rollback()
	if err = s.expire(ctx, tx); err != nil {
		return Quote{}, err
	}
	q, err := s.quote(ctx, tx, items, false)
	if err != nil {
		return q, err
	}
	if err = applyShipping(&q, input.Shipping); err != nil {
		return Quote{}, err
	}
	return q, tx.Commit()
}
func randomID(prefix string) (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b), nil
}

func (s *Store) CreateCheckout(ctx context.Context, key string, input CheckoutInput) (Checkout, bool, error) {
	return s.createCheckout(ctx, key, input, "")
}

func (s *Store) CreateAccountCheckout(ctx context.Context, key string, input CheckoutInput, account string) (Checkout, bool, error) {
	if account == "" {
		return Checkout{}, false, fault("unauthorized", "Entre na sua conta.", 401)
	}
	if len(key) < 16 || len(key) > 100 || strings.ContainsAny(key, "\r\n\t ") {
		return Checkout{}, false, fault("invalid_idempotency_key", "Chave de idempotência inválida.", 400)
	}
	sum := sha256.Sum256([]byte(account + "\x00" + key))
	return s.createCheckout(ctx, fmt.Sprintf("account_%x", sum), input, account)
}

func (s *Store) AccountCheckout(ctx context.Context, id, account, action string) (Checkout, error) {
	var token string
	if account == "" {
		return Checkout{}, fault("unauthorized", "Entre na sua conta.", 401)
	}
	if err := s.db.QueryRowContext(ctx, "SELECT token FROM checkouts WHERE id=? AND account_id=?", id, account).Scan(&token); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Checkout{}, fault("checkout_not_found", "Checkout não encontrado.", 404)
		}
		return Checkout{}, err
	}
	return s.Checkout(ctx, id, token, action)
}

func (s *Store) CheckoutForAccount(ctx context.Context, id, token, account, action string) (Checkout, error) {
	var exists int
	if account == "" {
		return Checkout{}, fault("unauthorized", "Entre na sua conta.", 401)
	}
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM checkouts WHERE id=? AND account_id=?", id, account).Scan(&exists); err != nil {
		return Checkout{}, err
	}
	if exists != 1 {
		return Checkout{}, fault("checkout_not_found", "Checkout não encontrado.", 404)
	}
	return s.Checkout(ctx, id, token, action)
}

type AccountPurchase struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"`
	Total     int64     `json:"total_cents"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) AccountPurchases(ctx context.Context, account string) ([]AccountPurchase, error) {
	if account == "" {
		return nil, fault("unauthorized", "Entre na sua conta.", 401)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = s.expire(ctx, tx); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id,state,quote,created_at FROM checkouts WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 30", account)
	if err != nil {
		return nil, err
	}
	result := []AccountPurchase{}
	for rows.Next() {
		var p AccountPurchase
		var quote string
		var created int64
		if err = rows.Scan(&p.ID, &p.Status, &quote, &created); err != nil {
			rows.Close()
			return nil, err
		}
		var q Quote
		if err = json.Unmarshal([]byte(quote), &q); err != nil {
			rows.Close()
			return nil, err
		}
		p.Total = q.Total
		p.CreatedAt = time.Unix(created, 0).UTC()
		result = append(result, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}

func (s *Store) createCheckout(ctx context.Context, key string, input CheckoutInput, account string) (Checkout, bool, error) {
	if len(key) < 16 || len(key) > 100 || strings.ContainsAny(key, "\r\n\t ") {
		return Checkout{}, false, fault("invalid_idempotency_key", "Envie Idempotency-Key com 16 a 100 caracteres, sem espaços.", 400)
	}
	items, err := normalizeItems(input.Items)
	if err != nil {
		return Checkout{}, false, err
	}
	input.Items = items
	if input.PaymentMethod != "pix" && input.PaymentMethod != "card" {
		return Checkout{}, false, fault("invalid_payment_method", "Escolha pix ou card, ambos simulados.", 400)
	}
	input.Shipping, err = normalizeShipping(input.Shipping)
	if err != nil {
		return Checkout{}, false, err
	}
	input.Delivery, err = normalizeDelivery(input.Delivery, input.Shipping)
	if err != nil {
		return Checkout{}, false, err
	}
	raw, _ := json.Marshal(input)
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Checkout{}, false, err
	}
	defer tx.Rollback()
	if err = s.expire(ctx, tx); err != nil {
		return Checkout{}, false, err
	}
	var oldID, oldHash string
	err = tx.QueryRowContext(ctx, `SELECT id,request_hash FROM checkouts WHERE idem_key=?`, key).Scan(&oldID, &oldHash)
	if err == nil {
		if oldHash != hash {
			return Checkout{}, false, fault("idempotency_conflict", "Essa chave já foi usada com outro carrinho ou meio de pagamento.", 409)
		}
		c, err := readCheckout(ctx, tx, oldID)
		if err != nil {
			return Checkout{}, false, err
		}
		return c, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Checkout{}, false, err
	}
	q, err := s.quote(ctx, tx, items, true)
	if err != nil {
		return Checkout{}, false, err
	}
	if err = applyShipping(&q, input.Shipping); err != nil {
		return Checkout{}, false, err
	}
	id, err := randomID("chk_")
	if err != nil {
		return Checkout{}, false, err
	}
	token, err := randomID("")
	if err != nil {
		return Checkout{}, false, err
	}
	now := s.now().UTC().Truncate(time.Second)
	c := Checkout{ID: id, Token: token, Status: "open", PaymentMethod: input.PaymentMethod, PaymentStatus: "simulated_pending", Quote: q, CreatedAt: now, ExpiresAt: now.Add(15 * time.Minute), Delivery: input.Delivery}
	quoteJSON, _ := json.Marshal(q)
	deliveryJSON, _ := json.Marshal(input.Delivery)
	_, err = tx.ExecContext(ctx, `INSERT INTO checkouts(id,token,idem_key,request_hash,state,payment_method,quote,created_at,expires_at,delivery,account_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, token, key, hash, c.Status, c.PaymentMethod, string(quoteJSON), now.Unix(), c.ExpiresAt.Unix(), string(deliveryJSON), account)
	if err != nil {
		return Checkout{}, false, err
	}
	return c, false, tx.Commit()
}

func readCheckout(ctx context.Context, tx *sql.Tx, id string) (Checkout, error) {
	var c Checkout
	var raw, deliveryRaw string
	var created, expires int64
	err := tx.QueryRowContext(ctx, `SELECT id,token,state,payment_method,quote,created_at,expires_at,order_id,delivery FROM checkouts WHERE id=?`, id).Scan(&c.ID, &c.Token, &c.Status, &c.PaymentMethod, &raw, &created, &expires, &c.OrderID, &deliveryRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return c, fault("checkout_not_found", "Checkout não encontrado.", 404)
	}
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal([]byte(raw), &c.Quote); err != nil {
		return c, err
	}
	if deliveryRaw != "" {
		if err = json.Unmarshal([]byte(deliveryRaw), &c.Delivery); err != nil {
			return c, err
		}
	}
	c.CreatedAt, c.ExpiresAt = time.Unix(created, 0).UTC(), time.Unix(expires, 0).UTC()
	c.PaymentStatus = "simulated_pending"
	if c.Status == "completed" {
		c.PaymentStatus = "simulated_approved"
	} else if c.Status != "open" {
		c.PaymentStatus = "simulated_" + c.Status
	}
	return c, nil
}
func (s *Store) Checkout(ctx context.Context, id, token, action string) (Checkout, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Checkout{}, err
	}
	defer tx.Rollback()
	if err = s.expire(ctx, tx); err != nil {
		return Checkout{}, err
	}
	c, err := readCheckout(ctx, tx, id)
	if err != nil {
		return c, err
	}
	if token == "" || sha256.Sum256([]byte(token)) != sha256.Sum256([]byte(c.Token)) {
		return Checkout{}, fault("checkout_not_found", "Checkout não encontrado.", 404)
	}
	switch action {
	case "":
	case "simulate-payment":
		if c.Status == "open" {
			orderID, e := randomID("ord_")
			if e != nil {
				return c, e
			}
			c.Status, c.PaymentStatus, c.OrderID = "completed", "simulated_approved", orderID
			if _, err = tx.ExecContext(ctx, `UPDATE checkouts SET state='completed',order_id=? WHERE id=?`, orderID, id); err != nil {
				return c, err
			}
		} else if c.Status != "completed" {
			if err = tx.Commit(); err != nil {
				return c, err
			}
			return c, fault("checkout_closed", "Checkout encerrado. Inicie uma nova compra de teste.", 409)
		}
	case "cancel":
		if c.Status == "open" {
			if err = s.release(ctx, tx, c.Quote); err != nil {
				return c, err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE checkouts SET state='canceled' WHERE id=?`, id); err != nil {
				return c, err
			}
			c.Status, c.PaymentStatus = "canceled", "simulated_canceled"
		} else if c.Status != "canceled" {
			return c, fault("checkout_closed", "Este checkout não pode mais ser cancelado.", 409)
		}
	default:
		return c, fault("invalid_action", "Ação desconhecida.", 400)
	}
	if err = tx.Commit(); err != nil {
		return c, err
	}
	c.Token = ""
	return c, nil
}
