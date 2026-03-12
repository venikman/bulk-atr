# Bulk ATR Producer

ATR server for `/fhir/*` reads and group-level asynchronous bulk export, backed
by deterministic checked-in seed data.

## Commands

```bash
deno task test
deno task check
deno task start
deno task dev
deno task db:migrate
deno task data:generate:large-200
deno task postman -- full
deno task postman:prod
deno task postman:local
```

## Repo layout

- `data/sources/`: canonical seed data for member coverage, provider directory,
  and claims attribution
- `data/profiles/large-200/`: optional larger checked-in fixture profile for
  scale-oriented local runs and tests
- `server/`: live ATR server, mapping logic, and runtime adapters
- `docs/architecture.md`: mapping rules, repo shape, and generated-artifact
  guidance
- `docs/fhir_data_interface.md`: source-data fields and ways to read the mapped
  FHIR output
- `docs/deno-deployment.md`: Deno Deploy runtime and Prisma Postgres deployment
  notes

## Notes

- `http://localhost:3001/` and the deployed root URL serve a small landing page
  with links to the main API routes.
- `/fhir/*` remains the runtime contract.
- Seed data remains split into three files because the runtime and tests both
  model three upstream domains.
- `DATA_PROFILE` selects the checked-in fixture set. Supported values are
  `default` and `large-200`; the default runtime profile is `default`.
- `deno task start` runs the Deno runtime locally against the same
  Postgres-backed runtime shape as production.
- `DATA_PROFILE=large-200 deno task start` runs the same server against the
  larger 200-member fixture without changing the default golden dataset.
- `deno task db:migrate` applies the raw SQL migrations in `db/migrations/`.
- Deno Deploy with Prisma Postgres is the only supported production runtime in
  this repo.
- Production deploys should be triggered only by pushes to `master`.
- Non-`master` branches may use preview deployments, but only `master` should
  update the production deployment.
- npm dependencies are allowed only through Deno `npm:` imports in `deno.json`;
  there is no Node runtime or npm-managed project flow.
- Bulk export work is claimed and completed on `/fhir/bulk-status/:jobId`; the
  runtime no longer depends on in-process background tasks.

## Postman smoke runner

- `deno task postman -- full` runs a Deno-native ATR smoke flow, using the
  checked-in Postman files as the reference for variables and request stages,
  against `https://venikman-bulk-atr.deno.dev/fhir`.
- Stage-only runs are supported with
  `deno task postman -- metadata|group|bulk|full`.
- Common flags: `--mode=prod|local`, `--base-url`, `--download-dir`,
  `--max-polls`, `--poll-interval-ms`.
- `deno task postman:prod` is a shortcut for the full production flow.
- `deno task postman:local` auto-starts `deno task start`, waits for
  `http://127.0.0.1:3001/fhir/metadata`, then tears the local server down when
  the collection finishes.
- `deno task postman -- full --mode=local --data-profile=large-200` runs the
  same smoke flow against the larger local fixture profile.
- Local mode requires `DATABASE_URL` or `POSTGRES_URL`, and you should run
  `deno task db:migrate` first so the local runtime can boot cleanly.
- The runner is fully Deno-native. It does not shell out to Newman, `npx`, or
  any Node CLI.
- The runner never rewrites the checked-in Postman environment. It uses a temp
  working environment file and saves NDJSON downloads under `.artifacts/` unless
  you override `--download-dir`.
