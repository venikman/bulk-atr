import postgres from "postgres";
import type {
  SqlClient,
  SqlQueryable,
  SqlQueryResult,
  SqlRow,
} from "../lib/sql-client.ts";

type PostgresQueryable = {
  unsafe<T extends SqlRow[]>(text: string, values?: unknown[]): Promise<T>;
};

const queryRows = async <T extends SqlRow>(
  queryable: PostgresQueryable,
  text: string,
  values?: unknown[],
): Promise<SqlQueryResult<T>> => ({
  rows: await queryable.unsafe<T[]>(text, values),
});

const toQueryable = (queryable: PostgresQueryable): SqlQueryable => ({
  query: <T extends SqlRow = SqlRow>(text: string, values?: unknown[]) =>
    queryRows<T>(queryable, text, values),
});

export const createPostgresSqlClient = (
  connectionString: string,
): SqlClient => {
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: "require",
  });

  return {
    query: <T extends SqlRow = SqlRow>(text: string, values?: unknown[]) =>
      queryRows<T>(sql, text, values),
    transaction: <T>(
      callback: (transaction: SqlQueryable) => Promise<T>,
    ) =>
      sql.begin<T>((transactionSql) =>
        callback(toQueryable(transactionSql))
      ) as Promise<T>,
    close: async () => {
      await sql.end({ timeout: 0 });
    },
  };
};
