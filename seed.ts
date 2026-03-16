/**
 * Deterministic seed data generator for clinical FHIR resources.
 *
 * Generates Encounter, Condition, Procedure, Observation,
 * MedicationRequest, and AllergyIntolerance resources that
 * reference the existing 50 patients, 10 practitioners,
 * 5 locations, and 6 organizations.
 *
 * Usage: bun run seed.ts
 * Requires DATABASE_URL or POSTGRES_URL environment variable.
 */

import { createPostgresSqlClient } from "./server/adapters/postgres-sql-client.ts";
import { applyPendingMigrations } from "./server/lib/migrations.ts";

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const patientId = (n: number) => `patient-${pad(n, 4)}`;
const practitionerId = (n: number) => `practitioner-${pad(n, 3)}`;
const locationId = (n: number) => `location-${pad(n, 3)}`;
const orgId = (n: number) => `org-provider-${pad(n, 3)}`;

const PATIENT_COUNT = 150;
const PRACTITIONER_COUNT = 15;
const LOCATION_COUNT = 8;
const ORG_COUNT = 8;

// Date pool — spread encounters across 2025
const baseDate = (patientIndex: number, encounterIndex: number) => {
  const month = ((patientIndex * 3 + encounterIndex * 7) % 12) + 1;
  const day = ((patientIndex * 5 + encounterIndex * 11) % 28) + 1;
  return `2025-${pad(month, 2)}-${pad(day, 2)}`;
};

// ---------------------------------------------------------------------------
// Clinical coding pools
// ---------------------------------------------------------------------------

const ICD10_CODES = [
  { code: "E11.9", display: "Type 2 diabetes mellitus without complications" },
  { code: "E11.65", display: "Type 2 diabetes mellitus with hyperglycemia" },
  { code: "I10", display: "Essential (primary) hypertension" },
  { code: "J06.9", display: "Acute upper respiratory infection, unspecified" },
  { code: "M54.5", display: "Low back pain" },
  { code: "J44.1", display: "Chronic obstructive pulmonary disease with acute exacerbation" },
  { code: "F32.9", display: "Major depressive disorder, single episode, unspecified" },
  { code: "K21.0", display: "Gastro-esophageal reflux disease with esophagitis" },
  { code: "N39.0", display: "Urinary tract infection, site not specified" },
  { code: "G43.909", display: "Migraine, unspecified, not intractable" },
];

const CPT_CODES = [
  { code: "99213", display: "Office visit, established patient, low complexity" },
  { code: "99214", display: "Office visit, established patient, moderate complexity" },
  { code: "99385", display: "Initial preventive medicine, 18-39 years" },
  { code: "99395", display: "Periodic preventive medicine, 18-39 years" },
  { code: "99203", display: "Office visit, new patient, low complexity" },
];

const ENCOUNTER_TYPES_CPT = [
  { code: "99213", display: "Office visit, established, low" },
  { code: "99214", display: "Office visit, established, moderate" },
  { code: "99203", display: "Office visit, new, low" },
];

const LOINC_VITAL_CODES = [
  { code: "85354-9", display: "Blood pressure panel", unit: "mmHg" },
  { code: "8867-4", display: "Heart rate", unit: "/min" },
  { code: "39156-5", display: "Body mass index", unit: "kg/m2" },
];

const LOINC_LAB_CODES = [
  { code: "4548-4", display: "Hemoglobin A1c", unit: "%" },
  { code: "2093-3", display: "Total Cholesterol", unit: "mg/dL" },
  { code: "2571-8", display: "Triglycerides", unit: "mg/dL" },
];

const RXNORM_CODES = [
  { code: "860975", display: "Metformin 500 MG Oral Tablet" },
  { code: "197361", display: "Amlodipine 5 MG Oral Tablet" },
  { code: "310798", display: "Lisinopril 10 MG Oral Tablet" },
  { code: "312961", display: "Omeprazole 20 MG Delayed Release Oral Capsule" },
];

const ALLERGY_CODES = [
  { code: "7980", display: "Penicillin", system: "http://www.nlm.nih.gov/research/umls/rxnorm" },
  { code: "2670", display: "Codeine", system: "http://www.nlm.nih.gov/research/umls/rxnorm" },
  { code: "1191", display: "Aspirin", system: "http://www.nlm.nih.gov/research/umls/rxnorm" },
  { code: "70618", display: "Sulfonamide", system: "http://www.nlm.nih.gov/research/umls/rxnorm" },
  { code: "102263", display: "Eggs", system: "http://snomed.info/sct" },
];

const ENCOUNTER_STATUSES = ["finished", "finished", "finished", "planned", "in-progress"] as const;
const CONDITION_CLINICAL_STATUSES = ["active", "active", "active", "resolved", "inactive"] as const;
const CONDITION_CATEGORIES = ["encounter-diagnosis", "problem-list-item"] as const;
const OBSERVATION_CATEGORIES_VITAL = "vital-signs";
const OBSERVATION_CATEGORIES_LAB = "laboratory";

// ---------------------------------------------------------------------------
// Resource builders
// ---------------------------------------------------------------------------

type FhirResource = Record<string, unknown>;

function buildEncounters(): FhirResource[] {
  const resources: FhirResource[] = [];
  let counter = 1;

  for (let p = 1; p <= PATIENT_COUNT; p++) {
    const encountersForPatient = 4;
    for (let e = 0; e < encountersForPatient; e++) {
      const id = `encounter-${pad(counter, 4)}`;
      const prac = (p + e) % PRACTITIONER_COUNT + 1;
      const loc = (p + e) % LOCATION_COUNT + 1;
      const org = (p + e) % ORG_COUNT + 1;
      const status = ENCOUNTER_STATUSES[(p + e) % ENCOUNTER_STATUSES.length];
      const icdIdx = (p + e) % ICD10_CODES.length;
      const cptIdx = (p + e) % ENCOUNTER_TYPES_CPT.length;
      const date = baseDate(p, e);
      const endDate = baseDate(p, e + 1);

      resources.push({
        resourceType: "Encounter",
        id,
        status,
        class: {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          code: "AMB",
          display: "ambulatory",
        },
        type: [
          {
            coding: [
              {
                system: "http://www.ama-assn.org/go/cpt",
                code: ENCOUNTER_TYPES_CPT[cptIdx].code,
                display: ENCOUNTER_TYPES_CPT[cptIdx].display,
              },
            ],
          },
        ],
        subject: { reference: `Patient/${patientId(p)}` },
        participant: [
          {
            individual: { reference: `Practitioner/${practitionerId(prac)}` },
          },
        ],
        period: { start: `${date}T09:00:00Z`, end: `${endDate}T09:30:00Z` },
        reasonCode: [
          {
            coding: [
              {
                system: "http://hl7.org/fhir/sid/icd-10-cm",
                code: ICD10_CODES[icdIdx].code,
                display: ICD10_CODES[icdIdx].display,
              },
            ],
          },
        ],
        location: [
          { location: { reference: `Location/${locationId(loc)}` } },
        ],
        serviceProvider: { reference: `Organization/${orgId(org)}` },
      });
      counter++;
    }
  }

  return resources;
}

function buildConditions(): FhirResource[] {
  const resources: FhirResource[] = [];
  let counter = 1;

  for (let p = 1; p <= PATIENT_COUNT; p++) {
    const conditionsForPatient = 3;
    for (let c = 0; c < conditionsForPatient; c++) {
      const id = `condition-${pad(counter, 4)}`;
      const icdIdx = (p * 3 + c) % ICD10_CODES.length;
      const clinicalStatus = CONDITION_CLINICAL_STATUSES[(p + c) % CONDITION_CLINICAL_STATUSES.length];
      const category = CONDITION_CATEGORIES[(p + c) % CONDITION_CATEGORIES.length];
      const encId = `encounter-${pad((p - 1) * 4 + (c % 4) + 1, 4)}`;
      const date = baseDate(p, c);

      resources.push({
        resourceType: "Condition",
        id,
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
              code: clinicalStatus,
            },
          ],
        },
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/condition-category",
                code: category,
                display: category === "encounter-diagnosis" ? "Encounter Diagnosis" : "Problem List Item",
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: "http://hl7.org/fhir/sid/icd-10-cm",
              code: ICD10_CODES[icdIdx].code,
              display: ICD10_CODES[icdIdx].display,
            },
          ],
        },
        subject: { reference: `Patient/${patientId(p)}` },
        encounter: { reference: `Encounter/${encId}` },
        recordedDate: `${date}T10:00:00Z`,
      });
      counter++;
    }
  }

  return resources;
}

function buildProcedures(): FhirResource[] {
  const resources: FhirResource[] = [];
  let counter = 1;

  for (let p = 1; p <= PATIENT_COUNT; p++) {
    // ~1-2 procedures per patient: first half get 2, second half get 1
    const count = p <= 75 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const id = `procedure-${pad(counter, 4)}`;
      const cptIdx = (p + i) % CPT_CODES.length;
      const encId = `encounter-${pad((p - 1) * 4 + (i % 4) + 1, 4)}`;
      const date = baseDate(p, i);

      resources.push({
        resourceType: "Procedure",
        id,
        status: "completed",
        code: {
          coding: [
            {
              system: "http://www.ama-assn.org/go/cpt",
              code: CPT_CODES[cptIdx].code,
              display: CPT_CODES[cptIdx].display,
            },
          ],
        },
        subject: { reference: `Patient/${patientId(p)}` },
        encounter: { reference: `Encounter/${encId}` },
        performedDateTime: `${date}T10:30:00Z`,
      });
      counter++;
    }
  }

  return resources;
}

function buildObservations(): FhirResource[] {
  const resources: FhirResource[] = [];
  let counter = 1;

  for (let p = 1; p <= PATIENT_COUNT; p++) {
    // 3 vital-signs + 3 laboratory = 6 per patient
    const encId = `encounter-${pad((p - 1) * 4 + 1, 4)}`;
    const date = baseDate(p, 0);

    for (let v = 0; v < LOINC_VITAL_CODES.length; v++) {
      const id = `observation-${pad(counter, 4)}`;
      const loinc = LOINC_VITAL_CODES[v];
      const value = loinc.code === "85354-9"
        ? 120 + (p % 40)
        : loinc.code === "8867-4"
          ? 60 + (p % 30)
          : 20 + (p % 15);

      resources.push({
        resourceType: "Observation",
        id,
        status: "final",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: OBSERVATION_CATEGORIES_VITAL,
                display: "Vital Signs",
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: loinc.code,
              display: loinc.display,
            },
          ],
        },
        subject: { reference: `Patient/${patientId(p)}` },
        encounter: { reference: `Encounter/${encId}` },
        effectiveDateTime: `${date}T09:15:00Z`,
        valueQuantity: {
          value,
          unit: loinc.unit,
          system: "http://unitsofmeasure.org",
        },
      });
      counter++;
    }

    for (let l = 0; l < LOINC_LAB_CODES.length; l++) {
      const id = `observation-${pad(counter, 4)}`;
      const loinc = LOINC_LAB_CODES[l];
      const value = loinc.code === "4548-4"
        ? 5.0 + (p % 8) * 0.3
        : loinc.code === "2093-3"
          ? 150 + (p % 50)
          : 100 + (p % 100);

      resources.push({
        resourceType: "Observation",
        id,
        status: "final",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: OBSERVATION_CATEGORIES_LAB,
                display: "Laboratory",
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: loinc.code,
              display: loinc.display,
            },
          ],
        },
        subject: { reference: `Patient/${patientId(p)}` },
        encounter: { reference: `Encounter/${encId}` },
        effectiveDateTime: `${date}T10:00:00Z`,
        valueQuantity: {
          value: Math.round(value * 10) / 10,
          unit: loinc.unit,
          system: "http://unitsofmeasure.org",
        },
      });
      counter++;
    }
  }

  return resources;
}

function buildMedicationRequests(): FhirResource[] {
  const resources: FhirResource[] = [];
  let counter = 1;

  for (let p = 1; p <= PATIENT_COUNT; p++) {
    const medsForPatient = 2;
    for (let m = 0; m < medsForPatient; m++) {
      const id = `medicationrequest-${pad(counter, 4)}`;
      const rxIdx = (p + m) % RXNORM_CODES.length;
      const prac = (p + m) % PRACTITIONER_COUNT + 1;
      const encId = `encounter-${pad((p - 1) * 4 + (m % 4) + 1, 4)}`;
      const date = baseDate(p, m);
      const status = (p + m) % 5 === 0 ? "stopped" : "active";

      resources.push({
        resourceType: "MedicationRequest",
        id,
        status,
        intent: "order",
        medicationCodeableConcept: {
          coding: [
            {
              system: "http://www.nlm.nih.gov/research/umls/rxnorm",
              code: RXNORM_CODES[rxIdx].code,
              display: RXNORM_CODES[rxIdx].display,
            },
          ],
        },
        subject: { reference: `Patient/${patientId(p)}` },
        encounter: { reference: `Encounter/${encId}` },
        authoredOn: `${date}T11:00:00Z`,
        requester: { reference: `Practitioner/${practitionerId(prac)}` },
      });
      counter++;
    }
  }

  return resources;
}

function buildAllergyIntolerances(): FhirResource[] {
  const resources: FhirResource[] = [];

  for (let p = 1; p <= PATIENT_COUNT; p++) {
    const id = `allergyintolerance-${pad(p, 4)}`;
    const allergyIdx = (p - 1) % ALLERGY_CODES.length;
    const allergy = ALLERGY_CODES[allergyIdx];

    resources.push({
      resourceType: "AllergyIntolerance",
      id,
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            code: "active",
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
            code: "confirmed",
          },
        ],
      },
      code: {
        coding: [
          {
            system: allergy.system,
            code: allergy.code,
            display: allergy.display,
          },
        ],
      },
      patient: { reference: `Patient/${patientId(p)}` },
      recordedDate: `2025-01-${pad((p % 28) + 1, 2)}T08:00:00Z`,
    });
  }

  return resources;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL or POSTGRES_URL");
    process.exit(1);
  }

  const sqlClient = createPostgresSqlClient(connectionString);

  try {
    await applyPendingMigrations(sqlClient);

    const allResources = [
      ...buildEncounters(),
      ...buildConditions(),
      ...buildProcedures(),
      ...buildObservations(),
      ...buildMedicationRequests(),
      ...buildAllergyIntolerances(),
    ];

    console.log(`Seeding ${allResources.length} clinical resources...`);

    // Batch upsert in chunks
    const BATCH_SIZE = 50;
    for (let i = 0; i < allResources.length; i += BATCH_SIZE) {
      const batch = allResources.slice(i, i + BATCH_SIZE);
      const valuePlaceholders: string[] = [];
      const values: unknown[] = [];

      for (let j = 0; j < batch.length; j++) {
        const resource = batch[j];
        const offset = j * 3;
        valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
        values.push(
          resource.resourceType,
          resource.id,
          JSON.stringify(resource),
        );
      }

      await sqlClient.query(
        `INSERT INTO fhir_resources (resource_type, resource_id, resource_json)
         VALUES ${valuePlaceholders.join(", ")}
         ON CONFLICT (resource_type, resource_id)
         DO UPDATE SET resource_json = EXCLUDED.resource_json, updated_at = NOW()`,
        values,
      );
    }

    // Summary
    const counts: Record<string, number> = {};
    for (const r of allResources) {
      const type = r.resourceType as string;
      counts[type] = (counts[type] ?? 0) + 1;
    }
    for (const [type, count] of Object.entries(counts)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log("Seed complete.");
  } finally {
    await sqlClient.close();
  }
}

main();
