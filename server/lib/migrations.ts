import type { SqlClient } from "./sql-client.ts";

const defaultMigrationsUrl = new URL("../../db/migrations/", import.meta.url);

const createMigrationsTable = async (sql: SqlClient) => {
  await sql.query(`
    create table if not exists _schema_migrations (
      name text primary key,
      applied_at timestamptz not null
    );
  `);
};

const listMigrationNames = async (migrationsUrl: URL) => {
  const names: string[] = [];

  for await (const entry of Deno.readDir(migrationsUrl)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      names.push(entry.name);
    }
  }

  names.sort((left, right) => left.localeCompare(right));
  return names;
};

export const applyPendingMigrations = async (
  sql: SqlClient,
  migrationsUrl = defaultMigrationsUrl,
) => {
  await createMigrationsTable(sql);

  const [available, appliedRows] = await Promise.all([
    listMigrationNames(migrationsUrl),
    sql.query<{ name: string }>("select name from _schema_migrations"),
  ]);

  const applied = new Set(appliedRows.rows.map((row) => row.name));
  const executed: string[] = [];

  for (const name of available) {
    if (applied.has(name)) {
      continue;
    }

    const sqlText = await Deno.readTextFile(new URL(name, migrationsUrl));
    const appliedAt = new Date().toISOString();

    await sql.transaction(async (transaction) => {
      await transaction.query(sqlText);
      await transaction.query(
        "insert into _schema_migrations (name, applied_at) values ($1, $2)",
        [name, appliedAt],
      );
    });

    executed.push(name);
  }

  return executed;
};
