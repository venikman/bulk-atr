import type { Context } from "hono";
import type { JsonObject } from "./types.ts";

export type IssueCode =
  | "invalid"
  | "not-supported"
  | "not-found"
  | "exception"
  | "login"
  | "throttled";

type FhirStatus = 200 | 400 | 401 | 404 | 429 | 500;

export const buildOperationOutcome = (
  code: IssueCode,
  diagnostics: string,
  severity: "error" | "fatal" = "error",
): JsonObject => ({
  resourceType: "OperationOutcome",
  issue: [
    {
      severity,
      code,
      diagnostics,
    },
  ],
});

export const fhirJson = (
  context: Context,
  payload: JsonObject,
  status: FhirStatus = 200,
) => {
  context.header("content-type", "application/fhir+json; charset=utf-8");
  context.status(status);
  return context.json(payload);
};

export const fhirOperationOutcome = (
  context: Context,
  status: Exclude<FhirStatus, 200>,
  code: IssueCode,
  diagnostics: string,
) => fhirJson(context, buildOperationOutcome(code, diagnostics), status);
