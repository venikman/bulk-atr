import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type PostmanEvent = {
  listen: string;
  script?: {
    exec?: string[];
  };
};

type PostmanItem = {
  name: string;
  item?: PostmanItem[];
  request?: {
    method: string;
    url:
      | string
      | {
          raw: string;
        };
  };
  event?: PostmanEvent[];
};

type PostmanCollection = {
  info: {
    name: string;
    schema: string;
  };
  item: PostmanItem[];
};

const flattenItems = (items: PostmanItem[]): PostmanItem[] =>
  items.flatMap((item) => [item, ...(item.item ? flattenItems(item.item) : [])]);

const getRequest = (collection: PostmanCollection, name: string) =>
  flattenItems(collection.item).find((item) => item.name === name);

const getRawUrl = (item: PostmanItem | undefined) =>
  typeof item?.request?.url === 'string' ? item.request.url : item?.request?.url?.raw;

const getTestScript = (item: PostmanItem | undefined) =>
  item?.event?.find((event) => event.listen === 'test')?.script?.exec?.join('\n');

describe('Postman collection artifact', () => {
  test('publishes a Postman v2.1 collection with ATR shared-state scripts', async () => {
    const filePath = resolve('postman/atr-producer-local.postman_collection.json');
    const raw = await readFile(filePath, 'utf8');
    const collection = JSON.parse(raw) as PostmanCollection;

    expect(collection.info.name).toBe('ATR Producer Local');
    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    );

    const metadata = getRequest(collection, 'Read CapabilityStatement');
    expect(getRawUrl(metadata)).toBe('{{baseUrl}}/metadata');

    const discoverGroup = getRequest(collection, 'Discover attribution Group');
    expect(getRawUrl(discoverGroup)).toBe(
      '{{baseUrl}}/Group?identifier={{groupIdentifier}}&_summary=true',
    );
    expect(getTestScript(discoverGroup)).toContain("pm.environment.set('groupId'");

    const readGroup = getRequest(collection, 'Read attribution Group');
    expect(getRawUrl(readGroup)).toBe('{{baseUrl}}/Group/{{groupId}}');

    const kickoff = getRequest(collection, 'Kick off ATR bulk export');
    expect(getRawUrl(kickoff)).toBe(
      '{{baseUrl}}/Group/{{groupId}}/$davinci-data-export?exportType={{exportType}}&_type={{exportTypes}}',
    );
    expect(getTestScript(kickoff)).toContain("pm.environment.set('bulkStatusUrl'");
    expect(getTestScript(kickoff)).toContain("pm.environment.set('jobId'");
    expect(getTestScript(kickoff)).toContain('groupFileUrl');
    expect(getTestScript(kickoff)).toContain('locationFileUrl');

    const pollStatus = getRequest(collection, 'Poll bulk export job status');
    expect(getRawUrl(pollStatus)).toBe('{{bulkStatusUrl}}');
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('groupFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('patientFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('coverageFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('relatedPersonFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('practitionerFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('practitionerRoleFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('organizationFileUrl'");
    expect(getTestScript(pollStatus)).toContain("pm.environment.set('locationFileUrl'");

    expect(getRawUrl(getRequest(collection, 'Download Group NDJSON'))).toBe('{{groupFileUrl}}');
    expect(getRawUrl(getRequest(collection, 'Download Patient NDJSON'))).toBe('{{patientFileUrl}}');
    expect(getRawUrl(getRequest(collection, 'Download Coverage NDJSON'))).toBe(
      '{{coverageFileUrl}}',
    );
    expect(getRawUrl(getRequest(collection, 'Download RelatedPerson NDJSON'))).toBe(
      '{{relatedPersonFileUrl}}',
    );
    expect(getRawUrl(getRequest(collection, 'Download Practitioner NDJSON'))).toBe(
      '{{practitionerFileUrl}}',
    );
    expect(getRawUrl(getRequest(collection, 'Download PractitionerRole NDJSON'))).toBe(
      '{{practitionerRoleFileUrl}}',
    );
    expect(getRawUrl(getRequest(collection, 'Download Organization NDJSON'))).toBe(
      '{{organizationFileUrl}}',
    );
    expect(getRawUrl(getRequest(collection, 'Download Location NDJSON'))).toBe(
      '{{locationFileUrl}}',
    );
  });
});
