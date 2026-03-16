# FHIR Data Interface

This repo exposes a runtime API under `/fhir/*`.

Use the seed-data `functions` sections to understand upstream contracts, then
read the live API to access mapped FHIR resources.

## Interface Overview

### Source-side functions

`data/sources/member-coverage-service.json`

- `listPatients() -> PatientSource[]`
- `listCoverages() -> CoverageSource[]`
- `listRelatedPersons() -> RelatedPersonSource[]`
- `listLocations() -> MemberLocationSource[]`

`data/sources/provider-directory-service.json`

- `listPractitioners() -> PractitionerSource[]`
- `listPractitionerRoles() -> PractitionerRoleSource[]`
- `listOrganizations() -> OrganizationSource[]`
- `listLocations() -> ProviderLocationSource[]`

`data/sources/claims-attribution-service.json`

- `listClaims() -> ClaimSource[]`
- `listAttributionLists() -> AttributionListSource[]`

## How To Get FHIR Data

### 1. Find a member in the attribution roster, then resolve its FHIR resources

Find the member row in the source attribution list:

```bash
jq '.functions.listAttributionLists.items[0].members[] | select(.memberId == "MBR000001")' \
  data/sources/claims-attribution-service.json
```

That row gives you:

- `patientSourceId`
- `coverageSourceId`
- `practitionerRoleSourceId`
- `changeType`

Resolve the same member in the live Patient read/search surface:

```bash
curl https://your-deployment.example/fhir/Patient/patient-0001 | jq
```

Resolve the attribution Group:

```bash
curl 'https://your-deployment.example/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true' | jq
```

### 2. Run the live bulk export flow

Kick off the export:

```bash
curl -i 'https://your-deployment.example/fhir/Group/group-2026-northwind-atr-001/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location'
```

Poll the returned `content-location` until it returns `200`, then download the
NDJSON URLs from the manifest response.

### 3. Use the live API directly

Use:

```bash
curl https://your-deployment.example/fhir/metadata | jq
curl 'https://your-deployment.example/fhir/Group?identifier=http://example.org/contracts|CTR-2026-NWACO-001&_summary=true' | jq
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
- `policyHolderType`
- `subscriberSourceId`
- `subscriberType`
- `subscriberId`
- `memberNumber`
- `dependentNumber`
- `relationshipCode`
- `relationshipDisplay`
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

Returns provider-role assignments linking practitioner, organization, and
location.

Mapped FHIR output:

- `PractitionerRole`

### `listOrganizations`

Returns payer, ACO, provider group, and licensing organization records.

Mapped FHIR output:

- `Organization`

### `listLocations`

There are two different source-side `listLocations` functions:

- member-coverage-service `listLocations()` returns member-side home location
  source data only
- provider-directory-service `listLocations()` returns provider-side
  service-site location data

Mapped FHIR output:

- only provider-directory-service locations become final `Location` resources

### `listClaims`

Returns source-only attribution evidence.

Important:

- these records help explain attribution
- these records do not become FHIR `Claim` resources in exported artifacts

### `listAttributionLists`

Returns the single contract-scoped attribution roster.

Fields include:

- `sourceId`
- `fhirId`
- `displayName`
- `contractId`
- `settlementEntityId`
- `payerOrganizationSourceId`
- `providerOrganizationSourceId`
- `status`
- `contractStart`
- `contractEnd`
- `members`

Each member row includes:

- `memberId`
- `patientSourceId`
- `coverageSourceId`
- `practitionerRoleSourceId`
- `attributionStart`
- `attributionEnd`
- `changeType`
- `status`
- `inactive`

Mapped FHIR output:

- one `Group`
- 150 `Group.member` entries

## Recommended Read Paths

If you need:

- live capability and route behavior: `/fhir/*`
- async export semantics and persistence model: `docs/deployment.md`
- mapping rules and invariants: `docs/architecture.md`
- upstream source contracts: `data/sources/*.json`

## Clinical Resources

In addition to the ATR resources, the API serves clinical FHIR resources with
search parameters. Seed data is generated by `bun run seed`.

### Supported resource types and search parameters

| Resource | Search Parameters |
|---|---|
| Patient | name, birthdate, gender, general-practitioner |
| Encounter | patient, date, status, type, practitioner, location, reason-code |
| Condition | patient, code, clinical-status, category |
| Procedure | patient, code |
| Observation | patient, code, category, date |
| MedicationRequest | patient, code, status |
| AllergyIntolerance | patient |

### Search examples

```bash
# Find patients by name
curl 'https://your-deployment.example/fhir/Patient?name=Smith'

# Encounters for a patient
curl 'https://your-deployment.example/fhir/Encounter?patient=Patient/patient-0001'

# Conditions by ICD-10 code prefix
curl 'https://your-deployment.example/fhir/Condition?code=http://hl7.org/fhir/sid/icd-10-cm|E11'

# Observations by LOINC code + date range
curl 'https://your-deployment.example/fhir/Observation?code=http://loinc.org|4548-4&date=ge2025-01-01'

# Active medications for a patient
curl 'https://your-deployment.example/fhir/MedicationRequest?patient=Patient/patient-0001&status=active'
```

## Important Notes

- Upstream `sourceId` values are not FHIR ids.
- Final FHIR ids are the `fhirId` values from the source contracts.
- Claims stay source-only and are intentionally excluded from the ATR outputs.
- `Group.member` is the main entry point for member-level ATR relationships
  because it links Patient, Coverage, attributed PractitionerRole, attribution
  period, and change type.
