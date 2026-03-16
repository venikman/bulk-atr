import { createPostgresSqlClient } from "./server/adapters/postgres-sql-client.ts";
import { SupabaseRestSqlClient } from "./server/adapters/supabase-rest-client.ts";
import { createRuntimeApp } from "./server/bootstrap/runtime.ts";
import { applyPendingMigrations } from "./server/lib/migrations.ts";
import type { SqlClient } from "./server/lib/sql-client.ts";

type Env = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

const buildSqlClient = (env: Env): SqlClient => {
  // Hyperdrive is a local proxy — disable SSL
  if (env.HYPERDRIVE?.connectionString) {
    return createPostgresSqlClient(env.HYPERDRIVE.connectionString, {
      ssl: false,
    });
  }

  const connectionString = env.DATABASE_URL ?? env.POSTGRES_URL;
  if (connectionString) {
    return createPostgresSqlClient(connectionString);
  }

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseRestSqlClient({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }

  throw new Error(
    "Set DATABASE_URL, POSTGRES_URL, HYPERDRIVE binding, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
  );
};

/* ---------- Entry point (Cloudflare Workers + Bun) ---------- */

let migrated = false;

export default {
  port: Number.parseInt(process.env.PORT ?? "3001", 10),

  async fetch(request: Request, env?: Env): Promise<Response> {
    const resolvedEnv: Env = env ?? {
      DATABASE_URL: process.env.DATABASE_URL,
      POSTGRES_URL: process.env.POSTGRES_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    // Build a fresh SQL client per request — Hyperdrive connection strings
    // are request-scoped and cannot be cached across invocations.
    const sql = buildSqlClient(resolvedEnv);

    if (!migrated) {
      await applyPendingMigrations(sql);
      migrated = true;
    }

    const app = createRuntimeApp({
      sql,
      supabaseUrl: resolvedEnv.SUPABASE_URL,
      supabaseKey: resolvedEnv.SUPABASE_SERVICE_ROLE_KEY,
    });

    return app.fetch(request);
  },
};
