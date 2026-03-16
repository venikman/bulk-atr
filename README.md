# Bulk ATR Producer

DaVinci ATR (Member Attribution) FHIR R4 producer server. Provides Group
discovery, linked resource reads, and group-level asynchronous bulk data export.

## Commands

```bash
bun run start                    # start the server (auto-migrates)
bun run check                    # typecheck only
bun run smoke full               # E2E smoke tests against prod
bun run smoke full --mode=local  # auto-start server + test
bun run deploy                   # deploy to Cloudflare Workers
```

## Repo layout

- `server/`: Hono app, route modules, adapters, and domain logic
- `docs/bruno/`: Bruno API collection for developers (import into Bruno)
- `docs/openapi.yaml`: OpenAPI 3.1 specification
- `docs/architecture.md`: mapping rules and invariants
- `docs/deployment.md`: deployment and runtime notes

## Notes

- `/fhir/*` is the runtime contract.
- `bun run start` runs the server locally against Postgres (auto-migrates on startup).
- Production deploys are triggered by pushes to `master`.
- Bulk export uses claim-based async processing; the runtime does not depend on
  in-process background tasks.

## Smoke runner

- `bun run smoke full` runs a fetch-based ATR smoke flow end-to-end.
- Stage-only runs: `bun run smoke metadata|group|bulk|full`.
- Common flags: `--mode=prod|local`, `--base-url`, `--download-dir`,
  `--max-polls`, `--poll-interval-ms`.
- `bun run smoke full --mode=local` auto-starts `bun run start`, waits for
  `http://127.0.0.1:3001/fhir/metadata`, then tears the local server down when
  done.
- Local mode requires `DATABASE_URL` or `POSTGRES_URL`.
- The runner is fully native — no external CLI dependencies.
- NDJSON downloads are saved under `.artifacts/` unless you override
  `--download-dir`.
