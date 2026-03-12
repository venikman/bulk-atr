export type SqlRow = Record<string, unknown>;

export type SqlQueryResult<T extends SqlRow = SqlRow> = {
  rows: T[];
};

export interface SqlQueryable {
  query<T extends SqlRow = SqlRow>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<T>>;
}

export interface SqlClient extends SqlQueryable {
  transaction<T>(
    callback: (transaction: SqlQueryable) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}
