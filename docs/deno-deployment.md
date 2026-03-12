# Deno Deploy Deployment

## Runtime shape

- Production entrypoint: `index.ts`
- Runtime: Deno Deploy
- Database: Prisma Postgres assigned through the Deno Deploy app configuration
- Dependencies: Deno-native imports plus npm packages via Deno `npm:` specifiers

## Required environment variables

- `DATABASE_URL` or `POSTGRES_URL`

Optional:

- `AUTH_MODE` Defaults to `none`. Set `smart-backend` to require bearer tokens
  on protected routes.
- `DATA_PROFILE` Defaults to `default`. Supported values are `default` and
  `large-200`.
- `PORT` Used for local `deno task start` runs. Defaults to `3001`.

## Local workflow

```bash
deno task db:migrate
deno task test
deno task check
deno task start
DATA_PROFILE=large-200 deno task start
```

## Production notes

- Deno Deploy should point at `index.ts` and run `deno task db:migrate` after a
  successful build.
- The repo does not use a Node runtime, `package.json`, `npx`, or npm install
  workflows.
- Prisma Postgres is infrastructure only in this repo; the app keeps raw SQL
  repositories and does not use Prisma ORM.
- Bulk export jobs are accepted on kickoff and completed from
  `/fhir/bulk-status/:jobId` through claim-based processing in Postgres.
- The deployed app preserves the current `/fhir/*` contract.
- `large-200` is intended for local scale verification; the default runtime
  profile remains `default` unless `DATA_PROFILE` is set explicitly.
