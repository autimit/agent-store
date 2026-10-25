# Agent Store

## UI

Use Glaze for every UI change. Read `.agents/skills/glaze/SKILL.md` and the official component documentation before editing. Import the theme in `src/main.tsx`, keep `glaze` on body, and keep `GlazePortalProvider` around the app. Use only Glaze components and semantic tokens. Run `.agents/skills/migrate-design-system/SKILL.md` for migrations and `.agents/skills/ui-review/SKILL.md` for screen reviews.

## Validation

Run `npm run build`, `npx eslint -c glaze.eslint.config.mjs .`, `go test ./...` and `go vet ./...`. Build the frontend before Go because `web/dist` is embedded. Use a fresh disposable SQLite database for browser tests. Never run purchase tests against the public store.

## Commerce

Preserve BRL cents calculated by Go, inventory reservations, per-checkout access tokens, stable idempotency keys and request bodies, reload recovery, and simulated-only payments. Keep API/WhatsApp credentials out of this repository. Do not change sibling projects.
