# FHIR Data Interface

This package exposes a file-based interface, not a runtime API.

Use the source-service `functions` sections to understand the upstream contracts, then use the mapped ATR outputs in `output/` to read final FHIR resources.

## Interface Overview

### Source-side functions

`input-services/member-coverage-service.json`

- `listPatients() -> PatientSource[]`
- `listCoverages() -> CoverageSource[]`
- `listRelatedPersons() -> RelatedPersonSource[]`
- `listLocations() -> MemberLocationSource[]`

`input-services/provider-directory-service.json`

- `listPractitioners() -> PractitionerSource[]`
- `listPractitionerRoles() -> PractitionerRoleSource[]`
- `listOrganizations() -> OrganizationSource[]`
- `listLocations() -> ProviderLocationSource[]`

`input-services/claims-attribution-service.json`

- `listClaims() -> ClaimSource[]`
- `listAttributionLists() -> AttributionListSource[]`

### Mapper function

`system/atr-producer-mapper.json`

- `buildBulkExport(memberCoverageFile, providerDirectoryFile, claimsAttributionFile) -> AtrBulkExportArtifacts`

Logical output of `buildBulkExport`:

- `output/atr_bulk_export_single.json`
- `output/bulk_status_response.json`
- `output/ndjson/Group.ndjson`
- `output/ndjson/Patient.ndjson`
- `output/ndjson/Coverage.ndjson`
- `output/ndjson/RelatedPerson.ndjson`
- `output/ndjson/Practitioner.ndjson`
- `output/ndjson/PractitionerRole.ndjson`
- `output/ndjson/Organization.ndjson`
- `output/ndjson/Location.ndjson`

## How To Get FHIR Data

### 1. Read the full consolidated export

Use this when you want all mapped FHIR resources in one JSON document.

```bash
jq '.resources' output/atr_bulk_export_single.json
```

Examples:

```bash
jq '.resources.Group[0]' output/atr_bulk_export_single.json
jq '.resources.Patient[0]' output/atr_bulk_export_single.json
jq '.resources.Coverage[0]' output/atr_bulk_export_single.json
```

### 2. Read one FHIR resource type as NDJSON

Use this when you want bulk-export style output.

```bash
head -n 1 output/ndjson/Patient.ndjson | jq
head -n 1 output/ndjson/Coverage.ndjson | jq
head -n 1 output/ndjson/PractitionerRole.ndjson | jq
```

Read all lines:

```bash
cat output/ndjson/Patient.ndjson | jq -c
```

### 3. Find a member in the attribution roster, then resolve its FHIR resources

Find the member row in the source attribution list:

```bash
jq '.functions.listAttributionLists.items[0].members[] | select(.memberId == "MBR000001")' \
  input-services/claims-attribution-service.json
```

That row gives you:

- `patientSourceId`
- `coverageSourceId`
- `practitionerRoleSourceId`
- `changeType`

Resolve the same member in final FHIR output:

```bash
jq '.resources.Patient[] | select(.identifier[]?.value == "MBR000001")' \
  output/atr_bulk_export_single.json
```

Resolve the matching Coverage:

```bash
jq '.resources.Coverage[] | select(.identifier[]?.value == "MBN000001")' \
  output/atr_bulk_export_single.json
```

Resolve the attributed provider from the Group entry:

```bash
jq '.resources.Group[0].member[] | select(.entity.reference == "Patient/patient-0001")' \
  output/atr_bulk_export_single.json
```

### 4. Read the bulk manifest first

Use this when you want the file list exactly like a bulk export consumer would.

```bash
jq '.output' output/bulk_status_response.json
```

## Function Contracts

### `listPatients`

Returns source patient records with:

- `sourceId`
- `fhirId`
- `memberId`
- `identifiers`
- `name`
- `telecom`
- `administrativeGender`
- `birthDate`
- `birthSex`
- `race`
- `ethnicity`
- `maritalStatus`
- `address`
- `communication`
- `contact`
- `generalPractitionerRoleSourceId`
- `managingOrganizationSourceId`
- `homeLocationSourceId`

Mapped FHIR output:

- `Patient`

### `listCoverages`

Returns source coverage records with:

- `sourceId`
- `fhirId`
- `memberId`
- `beneficiaryPatientSourceId`
- `policyHolderSourceId`
- `subscriberSourceId`
- `subscriberId`
- `memberNumber`
- `dependentNumber`
- `relationshipCode`
- `payorOrganizationSourceId`
- `planCode`
- `planDisplay`
- `planId`
- `periodStart`
- `periodEnd`

Mapped FHIR output:

- `Coverage`

### `listRelatedPersons`

Returns dependent subscriber and policy-holder source records.

Mapped FHIR output:

- `RelatedPerson`

### `listPractitioners`

Returns provider identity and credential source records.

Mapped FHIR output:

- `Practitioner`

### `listPractitionerRoles`

Returns provider-role assignments linking practitioner, organization, and location.

Mapped FHIR output:

- `PractitionerRole`

### `listOrganizations`

Returns payer, ACO, provider group, and licensing organization records.

Mapped FHIR output:

- `Organization`

### `listLocations`

There are two different source-side `listLocations` functions:

- member-coverage-service `listLocations()` returns member-side home location source data only
- provider-directory-service `listLocations()` returns provider-side service-site location data

Mapped FHIR output:

- only provider-directory-service locations become final `Location` resources

### `listClaims`

Returns source-only attribution evidence.

Important:

- these records help explain attribution
- these records do not become FHIR `Claim` resources in `output/`

### `listAttributionLists`

Returns the single contract-scoped attribution roster.

Mapped FHIR output:

- one `Group`
- 50 `Group.member` entries

## Recommended Read Paths

If you need:

- final FHIR resources in one file: `output/atr_bulk_export_single.json`
- final FHIR resources by type: `output/ndjson/*.ndjson`
- file manifest: `output/bulk_status_response.json`
- mapping rules: `system/atr-producer-mapper.json`
- upstream source contracts: `input-services/*.json`

## Important Notes

- Upstream `sourceId` values are not FHIR ids.
- Final FHIR ids are the `fhirId` values from the source contracts.
- Claims stay source-only and are intentionally excluded from the ATR outputs.
- `Group.member` is the main entry point for member-level ATR relationships because it links Patient, Coverage, attributed PractitionerRole, attribution period, and change type.
