import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type PostmanEnvironment = {
  name: string;
  values: Array<{
    key: string;
    value: string;
    enabled: boolean;
  }>;
  _postman_variable_scope: string;
};

const getValue = (environment: PostmanEnvironment, key: string) =>
  environment.values.find((entry) => entry.key === key);

describe('Postman environment artifact', () => {
  test('publishes a Postman environment with ATR defaults and runtime slots', async () => {
    const filePath = resolve('postman/atr-producer-local.postman_environment.json');
    const raw = await readFile(filePath, 'utf8');
    const environment = JSON.parse(raw) as PostmanEnvironment;

    expect(environment.name).toBe('ATR Producer Local Dev');
    expect(environment._postman_variable_scope).toBe('environment');

    expect(getValue(environment, 'baseUrl')?.value).toBe('http://localhost:3001/fhir');
    expect(getValue(environment, 'groupIdentifier')?.value).toBe(
      'http://example.org/contracts|CTR-2026-NWACO-001',
    );
    expect(getValue(environment, 'groupId')?.value).toBe('group-2026-northwind-atr-001');
    expect(getValue(environment, 'exportType')?.value).toBe('hl7.fhir.us.davinci-atr');
    expect(getValue(environment, 'exportTypes')?.value).toBe(
      'Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location',
    );

    expect(getValue(environment, 'bulkStatusUrl')?.value).toBe('');
    expect(getValue(environment, 'jobId')?.value).toBe('');
    expect(getValue(environment, 'groupFileUrl')?.value).toBe('');
    expect(getValue(environment, 'patientFileUrl')?.value).toBe('');
    expect(getValue(environment, 'coverageFileUrl')?.value).toBe('');
    expect(getValue(environment, 'relatedPersonFileUrl')?.value).toBe('');
    expect(getValue(environment, 'practitionerFileUrl')?.value).toBe('');
    expect(getValue(environment, 'practitionerRoleFileUrl')?.value).toBe('');
    expect(getValue(environment, 'organizationFileUrl')?.value).toBe('');
    expect(getValue(environment, 'locationFileUrl')?.value).toBe('');
  });
});
