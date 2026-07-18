import fs from 'node:fs';

const [configPath, projectId, userEmail, backupPath, applyFlag = ''] = process.argv.slice(2);
if (!configPath || !projectId || !userEmail || !backupPath) {
  throw new Error('Usage: node restore-firestore-portfolio-backup.mjs <firebase-config> <project> <email> <backup-json> [--apply]');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const accessToken = config?.tokens?.access_token;
if (!accessToken) throw new Error('Firebase CLI access token is unavailable');
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
if (backup?.kind !== 'my-portfolio-backup' || backup?.version !== 1 || !backup?.data) {
  throw new Error('Invalid portfolio backup');
}

const baseName = `projects/${projectId}/databases/(default)/documents`;
const baseUrl = `https://firestore.googleapis.com/v1/${baseName}`;
const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
const collectionFields = [
  'assets',
  'trades',
  'memos',
  'tradeLedger',
  'autoDividends',
  'confirmedDividends',
  'dividendAssetRegistry',
];

const decodeValue = (value = {}) => {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, decodeValue(nested)]),
  );
  return undefined;
};

const encodeValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)])),
    },
  };
};

const encodeFields = (value = {}) => Object.fromEntries(
  Object.entries(value).map(([key, nested]) => [key, encodeValue(nested)]),
);

const listDocuments = async (collectionPath) => {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${baseUrl}/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
    const body = await response.json();
    documents.push(...(body.documents || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
};

const hashIdentity = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getRecordIdentity = (field, record = {}, index = 0) => {
  if (record.id !== undefined && record.id !== null && String(record.id)) return `${field}:${String(record.id)}`;
  if (record.sourceId) return `${field}:source:${record.sourceId}`;
  return [
    field,
    record.assetId || '',
    record.name || '',
    record.ticker || '',
    record.side || record.action || '',
    record.date || record.buyDate || record.sellDate || '',
    record.quantity || '',
    record.price || record.buyPrice || record.sellPrice || '',
    index,
  ].join('::');
};

const roots = await listDocuments('portfolioStates');
const matchingRoot = roots.find((document) => {
  const email = decodeValue(document.fields?.userEmail || {});
  return String(email || '').toLowerCase() === userEmail.toLowerCase();
}) || (roots.length === 1 ? roots[0] : null);
if (!matchingRoot) throw new Error('Portfolio root for the requested email was not found');
const userId = matchingRoot.name.split('/').at(-1);

const desiredWrites = [];
const desiredNames = new Set();
const currentNames = [];
for (const field of collectionFields) {
  const currentDocuments = await listDocuments(`portfolioStates/${userId}/${field}`);
  currentNames.push(...currentDocuments.map((document) => document.name));
  (backup.data[field] || []).forEach((record, index) => {
    const documentId = `${field}-${hashIdentity(getRecordIdentity(field, record, index))}`;
    const name = `${baseName}/portfolioStates/${userId}/${field}/${documentId}`;
    desiredNames.add(name);
    desiredWrites.push({ update: { name, fields: encodeFields(record) } });
  });
}

const deleteWrites = currentNames
  .filter((name) => !desiredNames.has(name))
  .map((name) => ({ delete: name }));
const rootName = `${baseName}/portfolioStates/${userId}`;
const rootWrite = {
  update: {
    name: rootName,
    fields: encodeFields({
      schemaVersion: 2,
      migrationComplete: true,
      portfolioName: backup.data.portfolioName || '',
      targetPortfolio: backup.data.targetPortfolio || {},
      userEmail,
      recoverySource: backup.recoverySource || 'validated-backup',
    }),
  },
  updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
};

const plan = {
  apply: applyFlag === '--apply',
  currentDocuments: currentNames.length,
  deleteDocuments: deleteWrites.length,
  writeDocuments: desiredWrites.length,
  fields: Object.fromEntries(collectionFields.map((field) => [field, (backup.data[field] || []).length])),
};

if (applyFlag !== '--apply') {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const writes = [...deleteWrites, ...desiredWrites, rootWrite];
for (let start = 0; start < writes.length; start += 400) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes: writes.slice(start, start + 400) }),
  });
  if (!response.ok) throw new Error(`Firestore commit ${response.status}: ${await response.text()}`);
  await response.json();
}

console.log(JSON.stringify({ ...plan, committedWrites: writes.length }, null, 2));
