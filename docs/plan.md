# ATR mock plan

## Assumptions
- Target IG: Da Vinci Member Attribution (ATR) List v2.1.0 on FHIR R4.
- No API server is needed yet. Static JSON and NDJSON artifacts are enough.
- Final ATR scope is one contract-scoped Group resource with exactly 50 members.
- "Full demographics" means default provider-shareable ATR/US Core-aligned demographics for Patient and Practitioner.
- Omit SSN by default. Synthetic MRN, member ID, payer member number, Medicare or Medicaid identifiers may be included.

## Model
- member-coverage-service owns Patient, Coverage, RelatedPerson, and member-side Location source data.
- provider-directory-service owns Practitioner, PractitionerRole, Organization, and provider-side Location source data.
- claims-attribution-service owns Claim evidence and one internal attribution roster.
- atr-producer-mapper consumes the three upstream services and emits one consolidated ATR export plus NDJSON by resource type.

## Pick
- Build one Group resource for one 2026 contract and 50 attributed members.
- Emit a local consolidated JSON file for debugging plus a bulk-status manifest plus NDJSON output files.
- Use deterministic IDs and repeatable sequencing for all source IDs and FHIR IDs.
- Use 10 Practitioners, 10 PractitionerRoles, 6 Organizations, 5 provider Locations, 50 Patients, 50 Coverages, 16 RelatedPersons, and 100 Claims.

## Data policy
- Patient demographics include identifiers, official/usual names, telecom, gender, birthDate, birthSex, race, ethnicity, maritalStatus, county/district address, communication language, emergency contact, generalPractitioner, and managingOrganization.
- Practitioner demographics include NPI plus internal/provider-license identifiers, official name with prefix/suffix, telecom, address, gender, birthDate, qualification, and communication language.
- PractitionerRole carries organization, specialty, role, office telecom, and location references.
- Service addresses belong on Location; Practitioner.address is mailing/home/provider identity data.

## Generation rules
- Member index range is 1..50.
- RelatedPerson subscriber cases occur for 16 members with a realistic dependent mix.
- Claims are 2 per member for a total of 100 source claims.
- ChangeType distribution is 35 nochange, 10 changed, and 5 new.
- Attributed PractitionerRole rotates across 10 roles. Role locations rotate across 5 provider sites.

## Mapping
- Group.member.entity -> Patient
- Group.member.extension.ext-coverageReference -> Coverage
- Group.member.extension.ext-attributedProvider -> PractitionerRole
- Group.member.extension.ext-changeType -> new | changed | nochange
- Coverage.beneficiary -> Patient
- Coverage.subscriber / policyHolder -> Patient or RelatedPerson based on self/dependent case
- PractitionerRole.practitioner -> Practitioner
- PractitionerRole.organization -> Organization
- PractitionerRole.location -> Location

## Tests
- Group.quantity == 50
- len(Group.member) == 50
- len(Patient) == 50
- len(Coverage) == 50
- len(RelatedPerson) >= 16
- len(PractitionerRole) >= 10
- len(Location) >= 5
- len(Claim source records) >= 100
- Every reference resolves
- NDJSON parses line by line
- Claims do not appear in ATR export files

## Risks
- CI-build examples and published pages can differ slightly; use published canonical URLs and current change codes.
- Some trading partners will want a lighter demographic payload; keep full/default/minimal as a future generator toggle.
- Claim evidence is source-only here and not part of the exported ATR payload.

## Next
- Add a generator script with knobs for counts, geography, payer/provider mix, and demographic richness.
- Add validation against the ATR profiles with the HL7 validator once you choose the validation toolchain.