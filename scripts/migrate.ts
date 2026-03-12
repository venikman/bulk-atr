import { createPostgresSqlClient } from "../server/adapters/postgres-sql-client.ts";
import { applyPendingMigrations } from "../server/lib/migrations.ts";

const databaseUrl = Deno.env.get("DATABASE_URL") ??
  Deno.env.get("POSTGRES_URL");

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL or POSTGRES_URL must be configured to run migrations.",
  );
}

const sql = createPostgresSqlClient(databaseUrl);

try {
  const executed = await applyPendingMigrations(sql);
  if (executed.length === 0) {
    console.log("No pending migrations.");
  } else {
    for (const name of executed) {
      console.log(`Applied migration: ${name}`);
    }
  }
} finally {
  await sql.close();
}
