package store

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

type Catalog struct {
	Name     string    `json:"loja"`
	Demo     bool      `json:"demonstracao"`
	Currency string    `json:"moeda"`
	Products []Product `json:"produtos"`
}

type Product struct {
	ID          string    `json:"id"`
	Name        string    `json:"nome"`
	Category    string    `json:"categoria"`
	Description string    `json:"descricao"`
	Images      []Image   `json:"imagens"`
	Variants    []Variant `json:"variantes"`
}

type Image struct {
	ID      string   `json:"id"`
	Color   string   `json:"cor"`
	File    string   `json:"-"`
	Aliases []string `json:"apelidos"`
	URL     string   `json:"url"`
}

func (i *Image) UnmarshalJSON(data []byte) error {
	var raw struct {
		ID      string   `json:"id"`
		Color   string   `json:"cor"`
		File    string   `json:"arquivo"`
		Aliases []string `json:"apelidos"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	i.ID, i.Color, i.File, i.Aliases = raw.ID, raw.Color, raw.File, raw.Aliases
	i.URL = "/api/v1/images/" + i.ID
	return nil
}

type Variant struct {
	ID         string `json:"id"`
	Color      string `json:"cor"`
	Size       string `json:"tamanho"`
	PriceCents int64  `json:"preco_centavos"`
	Available  int    `json:"disponivel"`
	ImageID    string `json:"imagem_id"`
}

func LoadCatalog(path string) (Catalog, error) {
	f, err := os.Open(path)
	if err != nil {
		return Catalog{}, err
	}
	defer f.Close()
	var c Catalog
	d := json.NewDecoder(io.LimitReader(f, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return c, fmt.Errorf("catálogo contém dados adicionais")
	}
	if !c.Demo || c.Name == "" || c.Currency != "BRL" || len(c.Products) == 0 {
		return c, fmt.Errorf("catálogo deve identificar a loja demonstrativa em BRL")
	}
	seen := map[string]bool{}
	for _, p := range c.Products {
		if p.ID == "" || p.Name == "" || seen[p.ID] || len(p.Variants) == 0 {
			return c, fmt.Errorf("produto inválido")
		}
		seen[p.ID] = true
		images := map[string]bool{}
		for _, img := range p.Images {
			if img.ID == "" || img.Color == "" || seen[img.ID] || img.File == "" || filepath.Base(img.File) != img.File {
				return c, fmt.Errorf("imagem inválida")
			}
			seen[img.ID], images[img.ID] = true, true
		}
		for _, v := range p.Variants {
			if v.ID == "" || seen[v.ID] || v.Color == "" || v.Size == "" || v.PriceCents <= 0 || v.PriceCents > 100000000 || v.Available < 0 || !images[v.ImageID] {
				return c, fmt.Errorf("variante inválida")
			}
			seen[v.ID] = true
		}
	}
	return c, nil
}

func normalize(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func matches(p Product, q string) bool {
	text := p.ID + " " + p.Name + " " + p.Category + " " + p.Description
	for _, i := range p.Images {
		text += " " + i.Color + " " + strings.Join(i.Aliases, " ")
	}
	for _, v := range p.Variants {
		text += " " + v.Size
	}
	text = " " + normalize(text) + " "
	for _, term := range strings.Fields(normalize(q)) {
		if !strings.Contains(text, " "+term+" ") {
			return false
		}
	}
	return true
}
