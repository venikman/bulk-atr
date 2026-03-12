# ATR Architecture

## Repo shape

This repo centers on live ATR reads and bulk export through the `/fhir/*`
server.

The canonical source inputs live under `data/sources/`. Test-only parity helpers
live under `tests/`, not under the runtime server tree. Runtime persistence is
Postgres-only.

## Why the seed data stays split

The three JSON documents model separate upstream domains that are also reflected
in runtime bootstrapping:

- `member-coverage-service.json`: members, coverages, dependents, and
  member-side home locations
- `provider-directory-service.json`: practitioners, practitioner roles,
  organizations, and provider service locations
- `claims-attribution-service.json`: claims evidence and the attribution roster
  that becomes the ATR Group

Keeping the files separate preserves the domain boundaries used by the mapper
and makes it clear which source owns each identifier and relationship.

## Runtime persistence

The live server stores export job state, poll windows, manifests, and NDJSON
payloads in Postgres. The supported local runtime mode uses the same
Postgres-backed architecture; there is no separate blob/object-store dependency
in the current architecture.

## Mapping flow

The test-only parity helper and the live server use the same resolver/mapping
path.

1. Load the three seed documents.
2. Validate source links across collections and build indexes by `sourceId` and
   `fhirId`.
3. Build Organizations before dependent resources.
4. Build provider Locations from provider-directory locations only.
5. Build Practitioners and PractitionerRoles.
6. Build Patients and deterministic RelatedPersons.
7. Build Coverages with the correct Patient vs RelatedPerson
   subscriber/policy-holder semantics.
8. Build the contract-scoped Group and traverse linked references for export
   assembly.

## Deterministic invariants

- Generated timestamp is fixed at `2026-03-11T12:00:00Z` for internal reference
  exports.
- One Group is exported: `group-2026-northwind-atr-001`.
- Members, Patients, and Coverages are numbered `1..50`.
- Practitioners and PractitionerRoles are numbered `1..10`.
- Organizations are fixed at `6`; provider Locations are fixed at `5`.
- Claims are source-only evidence and never become FHIR `Claim` resources.
- Members `3, 6, 9, ..., 48` are dependent coverages and produce `RelatedPerson`
  resources.
- Member `i` maps to `practitionerrole-((i-1) mod 10)+1`.
- Role `i` maps to `location-((i-1) mod 5)+1`.
- Role `i` maps to provider organization `((i-1) mod 3)+1`.
- Change types are fixed: `1..35 nochange`, `36..45 changed`, `46..50 new`.

## Test parity helper

`tests/api/reference-export-helpers.ts` produces the same resource graph as the
live bulk export flow. That keeps parity and validation coverage without leaving
test-only assembly code inside `server/`.
