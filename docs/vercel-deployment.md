# Vercel deployment

## Runtime shape
- Production handler: `index.ts`
- Local development server: `server/main.ts`
- Vercel-local parity: `npm run dev:vercel`
- Vercel runtime target: `Node.js 22.x`

## Required environment variables
- `AUTH_MODE=none`
- `POSTGRES_URL` or `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`

## Manual production release flow
1. Link the repo to the Vercel project:

```bash
vercel link
```

2. Confirm the production branch remains `master`.

3. Deploy production manually from the repo root:

```bash
vercel deploy --prod
```

## Notes
- Git auto-deploy is intentionally deferred so Vercel does not create preview deployments for non-production branches.
- The deployed app preserves the current `/fhir/*` contract.
- Bulk export job state is stored in Postgres and artifacts are stored in private Vercel Blob objects.
