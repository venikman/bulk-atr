import type { AuthMode } from "../lib/auth.ts";
import type { SqlClient } from "../lib/sql-client.ts";
import { createRuntimeApp } from "./runtime.ts";

export type CreateLocalAppOptions = {
  authMode: AuthMode;
  sql: SqlClient;
};

export const createLocalApp = (
  { authMode, sql }: CreateLocalAppOptions,
) =>
  createRuntimeApp({
    authMode,
    sql,
  });
