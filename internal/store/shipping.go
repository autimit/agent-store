package store

import (
	"context"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"
)

type ShippingSelection struct {
	PostalCode string `json:"postal_code"`
	ServiceID  string `json:"service_id"`
}
type ShippingOption struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	PriceCents int64  `json:"price_cents"`
	MinDays    int    `json:"min_business_days"`
	MaxDays    int    `json:"max_business_days"`
}
type ShippingQuote struct {
	PostalCode string           `json:"postal_code"`
	Options    []ShippingOption `json:"options"`
	Currency   string           `json:"currency"`
	Demo       bool             `json:"demo"`
	Note       string           `json:"note"`
}
type QuoteInput struct {
	Items    []ItemInput        `json:"items"`
	Shipping *ShippingSelection `json:"shipping,omitempty"`
}
type Delivery struct {
	FullName     string `json:"full_name"`
	Email        string `json:"email"`
	Phone        string `json:"phone,omitempty"`
	PostalCode   string `json:"postal_code"`
	Street       string `json:"street"`
	Number       string `json:"number"`
	Complement   string `json:"complement,omitempty"`
	Neighborhood string `json:"neighborhood"`
	City         string `json:"city"`
	State        string `json:"state"`
}

var postalPattern = regexp.MustCompile(`^[0-9]{5}-?[0-9]{3}$`)

func normalizePostal(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if !postalPattern.MatchString(raw) {
		return "", fault("invalid_postal_code", "Informe um CEP com oito dígitos.", 400)
	}
	postal := strings.ReplaceAll(raw, "-", "")
	if postal == "00000000" {
		return "", fault("invalid_postal_code", "Informe um CEP válido para a simulação.", 400)
	}
	return postal, nil
}

// Deterministic fictional rates, deliberately independent from carrier APIs.
func shippingOptions(postal string) []ShippingOption {
	base := int64(1490)
	minDays, maxDays := 3, 6
	if postal[0] >= '4' {
		base = 1990
		minDays, maxDays = 5, 9
	}
	return []ShippingOption{{"standard", "Padrão", base, minDays, maxDays}, {"express", "Expresso", base + 1000, 1, 3}}
}
func normalizeShipping(selection *ShippingSelection) (*ShippingSelection, error) {
	if selection == nil {
		return nil, fault("shipping_required", "Calcule o frete e escolha uma opção de entrega.", 400)
	}
	postal, err := normalizePostal(selection.PostalCode)
	if err != nil {
		return nil, err
	}
	if selection.ServiceID != "standard" && selection.ServiceID != "express" {
		return nil, fault("invalid_shipping_service", "Escolha frete padrão ou expresso.", 400)
	}
	return &ShippingSelection{PostalCode: postal, ServiceID: selection.ServiceID}, nil
}
func applyShipping(q *Quote, selection *ShippingSelection) error {
	if selection == nil {
		q.ShippingRequired = true
		return nil
	}
	clean, err := normalizeShipping(selection)
	if err != nil {
		return err
	}
	for _, option := range shippingOptions(clean.PostalCode) {
		if option.ID == clean.ServiceID {
			chosen := option
			q.ShippingOption = &chosen
			q.PostalCode = clean.PostalCode
			q.Shipping = chosen.PriceCents
			q.Total = q.Subtotal + chosen.PriceCents
			q.ShippingRequired = false
			return nil
		}
	}
	return fault("invalid_shipping_service", "Frete não disponível.", 400)
}
func (s *Store) ShippingQuotes(ctx context.Context, items []ItemInput, postal string) (ShippingQuote, error) {
	postal, err := normalizePostal(postal)
	if err != nil {
		return ShippingQuote{}, err
	}
	if _, err = s.Quote(ctx, items); err != nil {
		return ShippingQuote{}, err
	}
	return ShippingQuote{PostalCode: postal, Options: shippingOptions(postal), Currency: "BRL", Demo: true, Note: "Valores e prazos fictícios. Não consulta transportadoras nem verifica a existência do CEP. Sem entrega real."}, nil
}
func normalizeDelivery(input *Delivery, shipping *ShippingSelection) (*Delivery, error) {
	if input == nil {
		return nil, fault("delivery_required", "Preencha os dados de contato e entrega da demonstração.", 400)
	}
	d := *input
	d.FullName = strings.Join(strings.Fields(d.FullName), " ")
	d.Email = strings.ToLower(strings.TrimSpace(d.Email))
	d.Phone = strings.TrimSpace(d.Phone)
	d.Street = strings.TrimSpace(d.Street)
	d.Number = strings.TrimSpace(d.Number)
	d.Complement = strings.TrimSpace(d.Complement)
	d.Neighborhood = strings.TrimSpace(d.Neighborhood)
	d.City = strings.TrimSpace(d.City)
	d.State = strings.ToUpper(strings.TrimSpace(d.State))
	postal, err := normalizePostal(d.PostalCode)
	if err != nil {
		return nil, err
	}
	d.PostalCode = postal
	if shipping == nil || postal != shipping.PostalCode {
		return nil, fault("postal_code_mismatch", "O CEP da entrega precisa ser o mesmo do frete escolhido.", 400)
	}
	fields := []struct {
		value    string
		min, max int
	}{{d.FullName, 2, 120}, {d.Street, 2, 160}, {d.Number, 1, 20}, {d.Neighborhood, 2, 100}, {d.City, 2, 100}, {d.Complement, 0, 120}, {d.Phone, 0, 25}}
	for _, f := range fields {
		length := utf8.RuneCountInString(f.value)
		if length < f.min || length > f.max || strings.ContainsAny(f.value, "\r\n\x00") {
			return nil, fault("invalid_delivery", "Confira os dados de contato e endereço.", 400)
		}
	}
	address, err := mail.ParseAddress(d.Email)
	if err != nil || address.Address != d.Email || len(d.Email) > 254 {
		return nil, fault("invalid_email", "Informe um e-mail válido para a demonstração.", 400)
	}
	states := " AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO "
	if len(d.State) != 2 || !strings.Contains(states, " "+d.State+" ") {
		return nil, fault("invalid_state", "Selecione a UF da entrega.", 400)
	}
	return &d, nil
}
