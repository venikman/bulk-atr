import { Hono } from "hono";
import type { AtrResolver } from "../lib/atr-resolver.ts";
import { fhirJson, fhirOperationOutcome } from "../lib/operation-outcome.ts";
import { supportedResourceTypes } from "../lib/types.ts";

const readableResourceTypes = supportedResourceTypes.filter(
  (resourceType) => resourceType !== "Group",
);

type ResourceReadOptions = {
  resolver: AtrResolver;
};

export const createResourceReadRoutes = ({ resolver }: ResourceReadOptions) => {
  const app = new Hono();

  app.get("/:resourceType", async (context) => {
    const resourceType = context.req.param("resourceType");

    if (!readableResourceTypes.includes(resourceType as (typeof readableResourceTypes)[number])) {
      return context.notFound();
    }

    const resources = await resolver.listByType(resourceType);
    return fhirJson(context, resolver.buildSearchBundle(resources, context.req.url));
  });

  app.get("/:resourceType/:id", async (context) => {
    const resourceType = context.req.param("resourceType");
    const id = context.req.param("id");

    if (!readableResourceTypes.includes(resourceType as (typeof readableResourceTypes)[number])) {
      return context.notFound();
    }

    const resource = await resolver.getResource(resourceType, id);
    if (!resource) {
      return fhirOperationOutcome(context, 404, "not-found", `${resourceType}/${id} was not found.`);
    }

    return fhirJson(context, resource);
  });

  return app;
};
