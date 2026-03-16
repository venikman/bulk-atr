import { Hono } from "hono";
import { createCapabilityStatement } from "../lib/capability-statement.ts";
import { fhirJson } from "../lib/operation-outcome.ts";

export const createMetadataRoutes = () => {
  const app = new Hono();

  app.get("/metadata", (context) => {
    const origin = new URL(context.req.url).origin;
    const statement = createCapabilityStatement(`${origin}/fhir`);
    return fhirJson(context, statement);
  });

  return app;
};
