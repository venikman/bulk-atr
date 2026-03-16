---
name: "atr-smoke-runner"
description: "Use when the user wants to run the ATR smoke flow, trigger a production bulk smoke test, run metadata/group-only stages, or execute the same workflow locally."
---

# ATR Smoke Runner

Use the repo wrapper in `smoke.ts`. It runs the ATR smoke flow
directly with `fetch` — no external CLI dependencies.

## Quick start

Default to the production API:

```bash
bun run smoke full
```

Useful stage-only runs:

```bash
bun run smoke metadata
bun run smoke group
bun run smoke bulk
```

## Flags

- `--mode=prod|local`
- `--base-url=<url>`
- `--download-dir=<path>`
- `--max-polls=<count>`
- `--poll-interval-ms=<ms>`

## Local mode

Use local mode only when `DATABASE_URL` or `POSTGRES_URL` is already set:

```bash
bun run smoke full --mode=local
```

The wrapper auto-starts `bun run start`, waits for `/fhir/metadata`, and shuts
the server down on exit.

## Reporting

When the workflow includes bulk export, report:

- the `bulkStatusUrl`
- the downloaded artifact paths

The runner uses a temp working environment file and saves NDJSON downloads
under `.artifacts/` unless you override `--download-dir`.
