# Vercel deployment

## Runtime shape

- Production handler: `index.ts`
- Vercel runtime target: `Node.js 24.x`

## Required environment variables

- `POSTGRES_URL` or `DATABASE_URL`

Optional:

- `AUTH_MODE`
  Defaults to `none`. Set `smart-backend` to require bearer tokens on protected routes.

## Production release flow

Primary command:

```bash
just deploy-prod
```

Optional local production-style start:

```bash
just start
```

## Notes

- Production is the only supported Vercel target in this repo; preview deploys are intentionally out of scope.
- `GET /` now serves a small HTML landing page in both local and production, while `/fhir/*` remains the API surface.
- `just start` pulls the linked production environment and runs the Vercel-local server with those values loaded into the local process.
- `just build`, `just test`, and `just check` are the direct justfile equivalents of the former package scripts.
- `just deploy-prod` runs `just test`, then pulls production settings, builds locally, and deploys the prebuilt output.
- The repo is already linked through `.vercel/project.json`; do not relink unless the target project changes.
- The deployed app preserves the current `/fhir/*` contract.
- Postgres stores asynchronous bulk export job metadata, throttled polling state, manifests, and NDJSON payloads.
- Artifact keys are logical identifiers backed by Postgres rows; they are no longer blob or filesystem paths.
- Vercel bundles the seed data from `data/sources/` into the serverless runtime.
