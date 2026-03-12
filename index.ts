import { createPostgresSqlClient } from "./server/adapters/postgres-sql-client.ts";
import { getDataProfileFromEnv } from "./server/bootstrap/data-profile.ts";
import { createRuntimeApp } from "./server/bootstrap/runtime.ts";
import { normalizeAuthMode } from "./server/lib/auth.ts";

const databaseUrl = Deno.env.get("DATABASE_URL") ??
  Deno.env.get("POSTGRES_URL");

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL or POSTGRES_URL must be configured for the runtime app.",
  );
}

const port = Number.parseInt(Deno.env.get("PORT") ?? "3001", 10);
const authMode = normalizeAuthMode(Deno.env.get("AUTH_MODE"));
const dataProfile = getDataProfileFromEnv(Deno.env.get("DATA_PROFILE"));
const sql = createPostgresSqlClient(databaseUrl);
const app = await createRuntimeApp({
  authMode,
  sql,
  dataProfile,
});

Deno.serve({ port }, app.fetch);
