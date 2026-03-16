import type { JsonObject } from "./types.ts";

const buildResource = (
  type: string,
  interactions: string[],
  searchParams: Array<{ name: string; type: string }> = [],
  operation?: { name: string; definition: string },
) => {
  const resource: JsonObject = {
    type,
    interaction: interactions.map((code) => ({ code })),
  };

  if (searchParams.length > 0) {
    resource.searchParam = searchParams;
  }

  if (operation) {
    resource.operation = [operation];
  }

  return resource;
};

export const createCapabilityStatement = (
  baseUrl: string,
): JsonObject => ({
  resourceType: "CapabilityStatement",
  status: "active",
  date: new Date().toISOString(),
  kind: "instance",
  fhirVersion: "4.0.1",
  format: ["json", "application/fhir+json"],
  instantiates: [
    "http://hl7.org/fhir/us/davinci-atr/CapabilityStatement/atr-producer",
  ],
  software: {
    name: "bulk-atr export-first producer",
    version: "0.1.0",
  },
  implementation: {
    description:
      "ATR producer server with Group discovery, linked reads, and group-level asynchronous bulk export.",
    url: baseUrl,
  },
  rest: [
    {
      mode: "server",
      resource: [
        buildResource(
          "Group",
          ["read", "search-type"],
          [
            { name: "identifier", type: "token" },
            { name: "name", type: "string" },
          ],
          {
            name: "davinci-data-export",
            definition:
              "http://hl7.org/fhir/us/davinci-atr/OperationDefinition/atr-group-davinci-data-export",
          },
        ),
        buildResource("Patient", ["read"]),
        buildResource("Coverage", ["read"]),
        buildResource("RelatedPerson", ["read"]),
        buildResource("Practitioner", ["read"]),
        buildResource("PractitionerRole", ["read"]),
        buildResource("Organization", ["read"]),
        buildResource("Location", ["read"]),
      ],
    },
  ],
});
