import type {
  SqlClient,
  SqlQueryable,
  SqlQueryResult,
  SqlRow,
} from "../../server/lib/sql-client.ts";

type QueryResult<T extends SqlRow = SqlRow> = {
  rows: T[];
};

type TransactionClient = {
  query<T extends SqlRow = SqlRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
  release(): void;
};

type PoolLike = {
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
  query<T extends SqlRow = SqlRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

const toResult = <T extends SqlRow>(
  result: QueryResult<T>,
): SqlQueryResult<T> => ({
  rows: result.rows,
});

const toQueryable = (queryable: {
  query<T extends SqlRow = SqlRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}): SqlQueryable => ({
  query: async <T extends SqlRow = SqlRow>(text: string, values?: unknown[]) =>
    toResult(await queryable.query<T>(text, values)),
});

export const createTestSqlClient = (pool: PoolLike): SqlClient => ({
  query: async <T extends SqlRow = SqlRow>(text: string, values?: unknown[]) =>
    toResult(await pool.query<T>(text, values)),
  transaction: async <T>(
    callback: (transaction: SqlQueryable) => Promise<T>,
  ) => {
    const client = await pool.connect();

    try {
      await client.query("begin");
      const result = await callback(toQueryable(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
  close: () => pool.end(),
});
