# Bulk ATR Producer

ATR server for `/fhir/*` reads and group-level asynchronous bulk export, backed by deterministic checked-in seed data.

## Commands

```bash
just build
just test
just check
just start
just deploy-prod
```

## Repo layout

- `data/sources/`: canonical seed data for member coverage, provider directory, and claims attribution
- `server/`: live ATR server, mapping logic, and runtime adapters
- `docs/architecture.md`: mapping rules, repo shape, and generated-artifact guidance
- `docs/fhir_data_interface.md`: source-data fields and ways to read the mapped FHIR output

## Notes

- `http://localhost:3000/` and the deployed root URL serve a small landing page with links to the main API routes.
- `/fhir/*` remains the runtime contract.
- Seed data remains split into three files because the runtime and tests both model three upstream domains.
- `just build`, `just test`, and `just check` replace the former package scripts directly in `justfile`.
- `just start` runs the production-like server locally against the same Postgres-backed runtime shape as production.
- Production deploys are the only supported Vercel workflow in this repo.
- `just deploy-prod` runs the test suite first, then the production Vercel build and deploy sequence.
