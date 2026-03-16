import { Hono } from "hono";
import type { AtrResolver } from "../lib/atr-resolver.ts";
import { fhirJson, fhirOperationOutcome } from "../lib/operation-outcome.ts";

type GroupRoutesOptions = {
  resolver: AtrResolver;
};

export const createGroupRoutes = ({ resolver }: GroupRoutesOptions) => {
  const app = new Hono();

  app.get("/Group", async (context) => {
    const identifier = context.req.query("identifier");
    const name = context.req.query("name");
    const summary = context.req.query("_summary");

    if (summary && summary !== "true") {
      return fhirOperationOutcome(context, 400, "invalid", "Only _summary=true is supported.");
    }

    if ((identifier && name) || (!identifier && !name)) {
      return fhirOperationOutcome(context, 400, "invalid", "Provide exactly one Group discovery parameter: identifier or name.");
    }

    let groups;
    if (identifier) {
      if (!identifier.includes("|")) {
        return fhirOperationOutcome(context, 400, "invalid", "Group identifier search must use the form {system}|{value}.");
      }
      groups = await resolver.findGroupsByIdentifier(identifier);
    } else {
      groups = await resolver.findGroupsByName(name || "");
    }

    return fhirJson(context, resolver.buildSearchBundle(groups, context.req.url));
  });

  app.get("/Group/:id", async (context) => {
    const group = await resolver.getGroupById(context.req.param("id"));
    if (!group) {
      return fhirOperationOutcome(context, 404, "not-found", "Group was not found.");
    }
    return fhirJson(context, group);
  });

  return app;
};
