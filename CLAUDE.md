# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreement (Sudus)

This repository runs under Sudus. `AGENTS.md` is the working agreement: read it and follow it. Run `sudus wake` at the start of every session and act only on its verdict.

- `docs/spec/` is the contract. `docs/spec/overview.md` maps each domain to its requirement prefix (`FOUND`, `DIR`, `PUB`, `THM`, and so on). `docs/spec/roadmap.md` names the current commitment.
- `docs/spec/`, `AGENTS.md`, and `.sudus/settings.json` are protected. They change only between commitments, with developer authorization.
- Each requirement has a mechanism: a definition in `.sudus/mechanisms/<name>.json` and a script in `mechanisms/check-*.mjs`. `sudus check <REQ>` runs it. The definition's `inputs` list is the set of declared inputs. Lease a change to a declared input with `sudus begin` and close it with `sudus end --lease <sha>` (see `AGENTS.md`).
- `README.md`, `docs/operator-manual.md`, `package.json`, `src/`, `tests/`, and `scripts/` are declared inputs. Some mechanisms check the text of the README and operator manual, so a doc edit can fail a check.
- `.sudus/settings.json` sets `"attribution": "forbidden"`. Do not add AI attribution to commits or PRs.
- Push with `sudus push`. Never push `refs/sudus/*` with plain `git push`.

## Commands

Requires Node.js 22.12 or newer and npm. Install with `npm ci` so the lockfile decides versions.

```sh
npm run dev                  # development server
npm run build                # production build (next build --webpack)
npm run start                # serve the production build
npm run lint                 # ESLint
npx tsc --noEmit             # type check
npm test                     # every tests/*.test.mjs, one file at a time
node --import tsx --test tests/seo-redirects.test.mjs   # one test file

npm run db:migrate           # Better Auth tables, then catalog migrations
npm run db:seed              # repeatable sample listings
npm run account:provision -- --email you@example.com --name "Site administrator"
npm run notifications:deliver  # send queued owner notices through Resend
npm run billing:reconcile      # reconcile provider billing state
npm run ops:backup -- --output <new-dir> --key-file <file>
npm run ops:restore -- --backup <dir> --target <new-dir>
```

- Keep `--webpack` on the build. A clean Turbopack build crashed with an internal panic (exit 134); decision `01M4M37DN0BS9BYRAHHH0XDW9J` in `docs/decisions.jsonl` records the switch. The Dockerfile build uses Webpack too.
- `tests/content-http.test.mjs`, `tests/admin-theme.test.mjs`, and `tests/theme-sdk.test.mjs` run `npm run build` into the shared `.next` directory and start a real server. They are slow. Do not run them in parallel with each other or with another build. This is why `npm test` uses `--test-concurrency=1`.
- Local setup: `cp .env.example .env.local`, then set `BETTER_AUTH_SECRET`. `BETTER_AUTH_URL` and `SITE_URL` must match the origin you open.

## Architecture

Next.js 16 App Router with React 19, TypeScript, shadcn/ui (Tailwind v4), Better Auth, and SQLite through `better-sqlite3`. `next.config.ts` turns on `cacheComponents` and `partialPrefetching`.

### Layers

- `src/app/` holds pages and route handlers. Route handlers stay thin: they check the session and capability, check the origin on writes, parse the body, and call into `src/lib/`.
- `src/lib/` holds the domain logic, one module per area (`listings`, `moderation`, `articles`, `media`, `plans`, `payment-*`, `seo-*`, `theme-*`, `agent-*`, and so on). Database calls are synchronous `better-sqlite3` statements.
- `scripts/` holds the CLI jobs. They run with `tsx` and import `scripts/load-env.mjs`, which loads `.env*` files the same way Next.js does.

### Database and migrations

- `src/lib/database.ts` opens one connection when it is imported. It reads `DATABASE_URL` (only `file:` URLs; the default is `.runtime/directory.db`).
- `src/lib/catalog-migrations.ts` owns the application schema. Each schema step is a numbered version recorded in the `catalog_migrations` table, and an existing database skips installed versions. Put a schema change in a new version; an edit to an old version never reaches existing databases.
- Most `src/lib` modules call `migrateCatalog()` at import time. The Dockerfile and `compose.yaml` set `DIRECTORY_EXPLICIT_MIGRATIONS=1`, which turns that off, so only `npm run db:migrate` changes the schema in a container.
- Better Auth tables are migrated separately by the `auth` CLI inside `db:migrate`.

### Access control

- Better Auth is configured in `src/lib/auth.ts`. A user's `role` is `admin`, `user`, or a comma-separated list of staff capabilities (`moderator`, `editor`, `catalog`, `taxonomy`, `billing`); see `src/lib/staff-roles.ts`.
- `src/lib/admin.ts` has the checks: `sessionUser` returns only verified, unbanned users, and `canModerate`, `canEditArticles`, `canManageCatalog`, and the rest test a capability. `admin` passes every check.
- Every session-based write route compares the `Origin` header with the `BETTER_AUTH_URL` origin (`sameOrigin`, `adminWriteGuard` in `src/lib/admin-api.ts`, or the shared `taxonomy-routes` and `media-routes` helpers). Webhooks check provider signatures instead, and the MCP endpoint checks agent keys.
- Shared helpers: `requestJson` / `requestJsonErrorResponse` (size-capped JSON body), `HttpError` / `httpErrorResponse` (domain errors to HTTP status), and `recordAudit` (audit log rows for staff actions).

### Request proxy

`src/proxy.ts` is the Next.js 16 proxy (the former middleware). It:

- serves permanent redirects stored in the database, built on `SITE_URL`;
- records missing paths for the SEO workspace;
- returns Markdown for published listing and article detail pages when the path ends in `.md`, the request sends `Accept: text/markdown`, or the user agent is a known LLM crawler;
- passes `x-directory-path` and `x-directory-request-id` headers to the app.

### Publication rules

- Content is public only while it is published. Owner edits to an approved listing are stored as a submission, and the public version stays in place until a moderator approves it (`src/lib/moderation.ts`).
- Uploaded images are private files in `MEDIA_DIR`. They are served only while their listing or article is published (`src/lib/media.ts`).
- Paid placement comes only from signed provider webhooks (`src/app/api/webhooks/*`, `src/lib/payment-lifecycle.ts`), never from a browser return. The providers are Stripe, Paddle, and NOWPayments. Saved billing profiles are encrypted with `BILLING_ENCRYPTION_KEY`.
- Agent imports come in through the remote MCP endpoint `src/app/api/mcp/route.ts` (authenticated by agent keys) and through WebMCP tools at `/admin/import`. Staged links stay private until a staff member publishes them (`src/lib/agent-imports.ts`).

### Theming

There are two layers: the saved shadcn/ui preset, and a registered custom theme plus a layout template.

- Themes live in `src/themes/`, must pass `src/lib/theme-sdk.ts` validation, and are registered in `src/themes/index.ts`.
- Templates are CSS files in `src/templates/`, scoped by `[data-template="<id>"]` and registered in `src/lib/theme-selection.ts`.
- For theme work, follow `.agents/skills/create-directory-theme/SKILL.md`.

### Tests

- Tests use the Node test runner (`tests/*.test.mjs`) and import TypeScript sources directly through `tsx`.
- `database.ts` reads `DATABASE_URL` when it is imported. Most tests set `process.env.DATABASE_URL` to a file in a temporary directory first, then load modules with dynamic `await import('../src/lib/...ts')`. They close the database and restore the variable in `finally`. Follow this pattern. A static import opens the shared `.runtime` database; `tests/page-metadata.test.mjs` and `tests/theme-sdk.test.mjs` still do this.

## Docs

- `README.md` covers the product overview and quick start.
- `docs/operator-manual.md` covers installation, staff workflows, providers, scheduled jobs, backup, restore, and containers.
- `UPGRADE.md` covers upgrade and rollback order.
