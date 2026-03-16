# Deployment

## Runtime shape

- Entrypoint: `index.ts`
- Production runtime: Cloudflare Workers (workerd)
- Local runtime: Bun
- Database: Supabase Postgres
- Framework: Hono v4
- SQL driver: postgres (porsager v3) via Hyperdrive

## Cloudflare Workers

- Worker name: `bulk-atr`
- Repository: `venikman/bulk-atr`
- Deploy command: `npx wrangler deploy` (git-triggered on push)
- Builds enabled for non-production branches
- Hyperdrive binding: `HYPERDRIVE` — connection pool to Supabase Postgres

## Observability strategy

### Grafana Cloud free tier (recommended)

- 10,000 metric series
- 50 GB logs
- 50 GB traces
- 14-day retention
- No credit card required
- Supports OpenTelemetry, Prometheus, Loki

### Built-in observability (implemented in codebase)

- Structured JSON request logging to stdout (method, path, status, duration)
- Health check endpoint at `GET /health`
- Platform-native log aggregation captures stdout

### Future enhancements (when needed)

- OpenTelemetry SDK for distributed tracing
- Prometheus metrics endpoint
- Grafana dashboards for bulk export job monitoring

## Required environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes* | -- | Postgres connection string |
| POSTGRES_URL | Yes* | -- | Alternative to DATABASE_URL |
| PORT | No | 3001 | HTTP listen port |

*One of DATABASE_URL or POSTGRES_URL required.

## Local workflow

```bash
bun install
bun run start        # start the server (auto-migrates, reads from DB)
bun run smoke full               # run E2E smoke tests against prod
bun run smoke full --mode=local  # auto-start server + test
```

## Production notes

- Production deploys triggered by pushes to master.
- CI must pass before merging (GitHub branch protection).
- Server auto-migrates on startup (creates tables if needed).
- Bulk export uses claim-based async processing in Postgres.
- FHIR resources stored as JSONB in `fhir_resources` table.
