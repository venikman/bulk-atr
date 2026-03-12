import { Hono } from "hono";
import type { AppEnv, AuthMode } from "../lib/auth.ts";
import { createCapabilityStatement } from "../lib/capability-statement.ts";
import { fhirJson } from "../lib/operation-outcome.ts";

export const createMetadataRoutes = (authMode: AuthMode) => {
  const app = new Hono<AppEnv>();

  app.get("/metadata", (context) => {
    const origin = new URL(context.req.url).origin;
    const statement = createCapabilityStatement(`${origin}/fhir`, authMode);
    return fhirJson(context, statement);
  });

  return app;
};
