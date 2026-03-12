import type { DataProfile } from "./data-profile.ts";
import type { AuthMode } from "../lib/auth.ts";
import type { SqlClient } from "../lib/sql-client.ts";
import { createRuntimeApp } from "./runtime.ts";

export type CreateLocalAppOptions = {
  authMode: AuthMode;
  sql: SqlClient;
  dataProfile?: DataProfile;
};

export const createLocalApp = (
  { authMode, sql, dataProfile }: CreateLocalAppOptions,
) =>
  createRuntimeApp({
    authMode,
    sql,
    dataProfile,
  });
