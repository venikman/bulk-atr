import { createPostgresSqlClient } from "./server/adapters/postgres-sql-client.ts";
import { SupabaseRestSqlClient } from "./server/adapters/supabase-rest-client.ts";
import { createRuntimeApp } from "./server/bootstrap/runtime.ts";
import { applyPendingMigrations } from "./server/lib/migrations.ts";
import type { SqlClient } from "./server/lib/sql-client.ts";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const buildSqlClient = (): SqlClient => {
  const explicit = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (explicit) {
    return createPostgresSqlClient(explicit);
  }

  if (supabaseUrl && supabaseKey) {
    return new SupabaseRestSqlClient({ supabaseUrl, serviceRoleKey: supabaseKey });
  }

  throw new Error(
    "Set DATABASE_URL, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
  );
};

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const sql = buildSqlClient();

await applyPendingMigrations(sql);

const app = createRuntimeApp({ sql, supabaseUrl, supabaseKey });

export default {
  port,
  fetch: app.fetch,
};
