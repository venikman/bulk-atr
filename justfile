set shell := ["sh", "-eu", "-c"]

build:
  npx tsc --project tsconfig.server.json

test:
  npx rstest --project api

check:
  npx biome check . && npx tsc --noEmit && npx tsc --project tsconfig.server.json --noEmit

start:
  vercel pull --yes --environment=production
  sh -ac 'set -a; . .vercel/.env.production.local; set +a; exec vercel dev --yes'

deploy-prod:
  just test
  vercel pull --yes --environment=production
  vercel build --prod
  vercel deploy --prebuilt --prod -y
