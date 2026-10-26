# Agent Store

## UI

Use Glaze for every UI change. Read `.agents/skills/glaze/SKILL.md` and the official component documentation before editing. Import the theme in `src/main.tsx`, keep `glaze` on body, and keep `GlazePortalProvider` around the app. Use only Glaze components and semantic tokens. Run `.agents/skills/migrate-design-system/SKILL.md` for migrations and `.agents/skills/ui-review/SKILL.md` for screen reviews.

## Validation

Run `npm run build`, `npx eslint -c glaze.eslint.config.mjs .`, `go test ./...` and `go vet ./...`. Build the frontend before Go because `web/dist` is embedded. Use a fresh disposable SQLite database for browser tests. Never run purchase tests against the public store.

## Commerce

Preserve BRL cents calculated by Go, inventory reservations, per-checkout access tokens, stable idempotency keys and request bodies, reload recovery, and simulated-only payments. Keep API/WhatsApp credentials out of this repository. Do not change sibling projects.

## Authentication

Use Better Auth and its official OAuth Provider/CIMD plugins. The user explicitly rejected building an OAuth server from scratch. Keep password hashing, sessions, authorization codes, PKCE, tokens and OAuth validation in the library. Go owns commerce and checkout ownership. Any Poppy companion integration must reuse this provider and be tested against the pinned official specification; never announce Poppy/Instinct support just because OAuth works. Local auth state and secrets live in ignored `.runtime/`; test identities in ignored `.poppy/`. Never print either. Use disposable auth and commerce databases for tests.

Checkout now requires a valid account on every HTTP path; never fall back to guest writes. Bind the attempt's account, idempotency key and body before creation; X-Checkout-Account must match the verified session. Preserve ambiguous-response recovery for the original account. A checkout token alone must not bypass account ownership. Account history must exclude other accounts and tokens. Keep cart/login return internal and preserve the original account's delivery draft and shipping selection across reauthentication.
