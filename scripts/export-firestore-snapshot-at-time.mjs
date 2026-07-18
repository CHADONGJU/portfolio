import fs from 'node:fs';
import path from 'node:path';

const [configPath, projectId, userEmail, readTimesText, outputDirectory] = process.argv.slice(2);
if (!configPath || !projectId || !userEmail || !readTimesText || !outputDirectory) {
  throw new Error('Usage: node export-firestore-snapshot-at-time.mjs <firebase-config> <project> <email> <read-times-comma-separated> <output-directory>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const accessToken = config?.tokens?.access_token;
if (!accessToken) throw new Error('Firebase CLI access token is unavailable');

const decodeValue = (value = {}) => {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
};

const decodeFields = (fields = {}) => Object.fromEntries(
  Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
);

const listDocuments = async (collectionPath, readTime) => {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    if (readTime !== 'NOW') url.searchParams.set('readTime', readTime);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
    const body = await response.json();
    documents.push(...(body.documents || []).map((document) => ({
      id: document.name.split('/').at(-1),
      data: decodeFields(document.fields || {}),
    })));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
};

const collectionFields = [
  'assets',
  'trades',
  'memos',
  'tradeLedger',
  'autoDividends',
  'confirmedDividends',
  'dividendAssetRegistry',
];

fs.mkdirSync(outputDirectory, { recursive: true });
const summaries = [];

for (const readTime of readTimesText.split(',').map((value) => value.trim()).filter(Boolean)) {
  const roots = await listDocuments('portfolioStates', readTime);
  const matchingRoot = roots.find(({ data }) => String(data.userEmail || '').toLowerCase() === userEmail.toLowerCase())
    || (roots.length === 1 ? roots[0] : null);
  if (!matchingRoot) {
    summaries.push({ readTime, found: false, rootCount: roots.length });
    continue;
  }

  const entries = await Promise.all(collectionFields.map(async (field) => [
    field,
    (await listDocuments(`portfolioStates/${matchingRoot.id}/${field}`, readTime)).map(({ data }) => data),
  ]));
  const data = {
    portfolioName: matchingRoot.data.portfolioName || '',
    targetPortfolio: matchingRoot.data.targetPortfolio || {},
    ...Object.fromEntries(entries),
  };
  const backup = {
    kind: 'my-portfolio-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    recoverySource: `firestore-read-time:${readTime}`,
    data,
  };
  const outputPath = path.join(outputDirectory, `firestore-${readTime.replaceAll(':', '-').replace('.000Z', 'Z')}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  summaries.push({
    readTime,
    found: true,
    rootUpdatedAt: matchingRoot.data.updatedAt || '',
    outputPath,
    assets: data.assets.length,
    tradeLedger: data.tradeLedger.length,
    memos: data.memos.length,
    autoDividends: data.autoDividends.length,
    confirmedDividends: data.confirmedDividends.length,
  });
}

console.log(JSON.stringify(summaries, null, 2));
