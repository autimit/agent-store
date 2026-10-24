package web

import "embed"

//go:embed *.html *.css *.js *.woff2 *.png openapi.json
var Files embed.FS
