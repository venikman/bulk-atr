# AGENTS.md — Bulk ATR Producer

## Stack

| Layer      | Choice                       | Notes                                    |
|------------|------------------------------|------------------------------------------|
| Runtime    | **Cloudflare Workers**       | Production; Bun for local dev            |
| Framework  | **Hono** (v4)                | Runtime-agnostic                         |
| Database   | **Supabase Postgres**        | FHIR resources stored as JSONB           |
| SQL driver | **postgres** (porsager, v3)  | Via Hyperdrive in prod, direct TCP local |
| Deploy     | `npx wrangler deploy`        | Git-triggered, no build step             |
| Binding    | **Hyperdrive** → `HYPERDRIVE`| Connection pool to Supabase Postgres     |
| Testing    | **Smoke runner** (fetch)    | E2E happy-path only, no bun:test         |
| CI         | GitHub Actions + Postgres service |                                      |

## Commands

```bash
bun install              # install dependencies
bun run start            # start the server (auto-migrates, reads from DB)
bun run check            # typecheck only
bun run smoke full       # run the E2E smoke flow
bun run deploy           # bunx wrangler deploy
```

## Architecture decisions

### Why Bun (not Deno, not Node)

- Native TCP sockets let the `postgres` driver connect directly to Postgres
  without HTTP proxies or adapter hacks.
- `Bun.spawn` for local server auto-start in smoke runner.

### Deployment target: Cloudflare Workers

- The project will be deployed to Cloudflare Workers.
- This requires adapting the entry point and runtime APIs to the workerd environment.
- See `docs/deployment.md` for platform details and migration notes.

## File structure

```
index.ts                        # Bun entry point (export default { port, fetch })
smoke.ts                        # fetch-based E2E smoke runner
package.json                    # dependencies and scripts
tsconfig.json                   # Bun types, ESNext target
server/
  app.ts                        # Hono app factory (logging, health, routes)
  bootstrap/                    # runtime app assembly
  adapters/                     # Postgres implementations (fhir-store, job repo, artifact store, sql client)
  lib/                          # domain logic (atr-resolver, fhir-store interface, migrations, types)
  routes/                       # Hono route modules (bulk, resource-read, group, metadata)
docs/
  schema.sql                    # complete database DDL (all tables)
  capability-statement.json     # FHIR CapabilityStatement reference
  architecture.md               # mapping rules and invariants
  deployment.md                 # deployment, platform, and observability
  bruno/                        # Bruno API collection for developers
```

## Testing rules

- **TDD workflow.** Write the smoke test (red) before implementing the feature (green). One test at a time.
- **Smoke-only E2E.** The smoke runner (`smoke.ts`) is the sole test mechanism. No bun:test, no pg-mem.
- **Happy path only.** Tests verify the success flow, not error cases.
- **No unit tests.** Do not add tests that call internal functions directly.
- **No mocking internal modules.** Only `fetchImpl` and `startLocalServer`
  may be injected as dependencies (for the smoke runner).

## Rules

- **Always read `docs/` before making architecture or deployment decisions.** The docs contain current decisions and constraints that override assumptions.

## Do NOT

- Add `Dockerfile`, `vercel.json`, or `justfile`.
- Add a `scripts/` directory — entry-point scripts live at the root.
- Reference Deno APIs (`Deno.*`) anywhere in the codebase.
- Add bun:test tests or pg-mem — use the smoke runner for all testing.
- Add UI, HTML pages, or frontend code — only FHIR JSON APIs.
- Commit `.env` files or database credentials.
- Skip the TDD cycle — always write the test first.

## Environment variables

| Variable       | Required | Default   | Description                        |
|----------------|----------|-----------|------------------------------------|
| `DATABASE_URL` | Yes*     | —         | Postgres connection string         |
| `POSTGRES_URL` | Yes*     | —         | Alternative to `DATABASE_URL`      |
| `PORT`         | No       | `3001`    | HTTP listen port                   |

*One of `DATABASE_URL` or `POSTGRES_URL` is required.
