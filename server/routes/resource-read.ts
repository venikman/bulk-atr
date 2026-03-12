import { Hono } from "hono";
import type { AtrResolver } from "../lib/atr-resolver.ts";
import { type AppEnv, createAuthMiddleware } from "../lib/auth.ts";
import { fhirJson, fhirOperationOutcome } from "../lib/operation-outcome.ts";
import { supportedResourceTypes } from "../lib/types.ts";

const readableResourceTypes = supportedResourceTypes.filter(
  (resourceType) => resourceType !== "Group",
);

type ResourceReadOptions = {
  resolver: AtrResolver;
  authMode: "none" | "smart-backend";
};

export const createResourceReadRoutes = (
  { resolver, authMode }: ResourceReadOptions,
) => {
  const app = new Hono<AppEnv>();
  app.use("/:resourceType/:id", createAuthMiddleware(authMode));

  app.get("/:resourceType/:id", (context) => {
    const resourceType = context.req.param("resourceType");
    const id = context.req.param("id");

    if (
      !readableResourceTypes.includes(
        resourceType as (typeof readableResourceTypes)[number],
      )
    ) {
      return context.notFound();
    }

    const resource = resolver.getResource(resourceType, id);
    if (!resource) {
      return fhirOperationOutcome(
        context,
        404,
        "not-found",
        `${resourceType}/${id} was not found.`,
      );
    }

    return fhirJson(context, resource);
  });

  return app;
};
