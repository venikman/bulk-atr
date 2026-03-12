---
name: "atr-postman-runner"
description: "Use when the user wants to run the ATR Postman collection, trigger a production bulk smoke flow, run metadata/group-only Postman stages, or execute the same workflow locally through the repo wrapper."
---

# ATR Postman Runner

Use the repo wrapper in `scripts/postman.ts`. It runs the ATR smoke flow
directly with Deno `fetch` and uses the checked-in Postman files as the stage
and variable reference.

## Quick start

Default to the deployed production API:

```bash
deno task postman -- full
```

This defaults to `https://venikman-bulk-atr.deno.dev/fhir`.

Useful stage-only runs:

```bash
deno task postman -- metadata
deno task postman -- group
deno task postman -- bulk
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
deno task postman -- full --mode=local
```

The wrapper auto-starts `deno task start`, waits for `/fhir/metadata`, and shuts
the server down on exit. If the local runtime has not been migrated yet, run:

```bash
deno task db:migrate
```

## Reporting

When the workflow includes bulk export, report:

- the `bulkStatusUrl`
- the downloaded artifact paths

The checked-in Postman collection and environment under `docs/postman/` are the
source of truth. The wrapper uses a temp working environment file, does not
rewrite the checked-in environment JSON, and does not depend on Newman, `npx`,
or any Node CLI.
