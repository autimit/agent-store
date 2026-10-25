package web

import "embed"

//go:embed dist openapi.json t-shirt.png
var Files embed.FS
