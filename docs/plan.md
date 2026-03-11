# Static ATR Mock Package

## Summary
- Deterministic Da Vinci ATR v2.1.0 mock package on FHIR R4 for one 2026 contract-scoped attribution list.
- Synthetic data only. No API, server, CLI, database schema, or Claim export artifacts.
- Fixed generated timestamp: `2026-03-11T12:00:00Z`.

## Package Contents
- `input-services/member-coverage-service.json`: 50 Patients, 50 Coverages, 16 RelatedPersons, 50 member-side source Locations.
- `input-services/provider-directory-service.json`: 10 Practitioners, 10 PractitionerRoles, 6 Organizations, 5 provider Locations.
- `input-services/claims-attribution-service.json`: 100 source Claims and one attribution list with 50 member rows.
- `system/atr-producer-mapper.json`: offline `buildBulkExport` mapping contract.
- `output/atr_bulk_export_single.json`: consolidated ATR export.
- `output/bulk_status_response.json`: bulk-style manifest for 8 NDJSON outputs.
- `output/ndjson/*.ndjson`: one file each for Group, Patient, Coverage, RelatedPerson, Practitioner, PractitionerRole, Organization, and Location.

## Deterministic Rules
- Members, Patients, and Coverages are numbered 1..50.
- Practitioners and PractitionerRoles are numbered 1..10.
- Organizations are fixed at 6 and provider Locations at 5.
- Each member rotates across attributed PractitionerRole ids using `((i-1) mod 10)+1`.
- Each role rotates across provider Locations using `((i-1) mod 5)+1` and provider Organizations using `((i-1) mod 3)+1`.
- Dependent coverages exist for members 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, and 48.
- Change types are fixed: members 1..35 `nochange`, 36..45 `changed`, and 46..50 `new`.

## Mapping Notes
- Upstream `sourceId` values never replace FHIR resource ids.
- Patient examples include ATR profile plus US Core race, ethnicity, and birth sex extensions.
- Practitioner examples keep personal or mailing identity address on Practitioner and service-site address on Location.
- Coverage references Patient or RelatedPerson for subscriber and policyHolder depending on dependent status.
- Claims remain source-only inputs used to justify attribution and are intentionally absent from ATR outputs.

## Validation Targets
- Group quantity and Group member count both equal 50.
- Patient count equals 50, Coverage count equals 50, RelatedPerson count equals 16.
- PractitionerRole count equals 10, Organization count equals 6, Location count equals 5.
- Every FHIR reference resolves within the consolidated export.
- Every NDJSON file parses one JSON object per line.
- `output/bulk_status_response.json` lists all 8 NDJSON files.
