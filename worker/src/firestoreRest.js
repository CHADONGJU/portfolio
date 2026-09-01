const DEFAULT_DATABASE = '(default)';
const COMMIT_WRITE_LIMIT = 400;

const encodeNumber = (value) => (
  Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
);

export const encodeFirestoreValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? encodeNumber(value) : { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeFirestoreValue(child)])),
      },
    };
  }
  return { stringValue: String(value) };
};

export function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

export const encodeFirestoreFields = (data = {}) => Object.fromEntries(
  Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)]),
);

export function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

const documentRoot = (projectId) => (
  `projects/${projectId}/databases/${DEFAULT_DATABASE}/documents`
);

const baseUrl = (projectId) => `https://firestore.googleapis.com/v1/${documentRoot(projectId)}`;

const authHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

const readJson = async (response, label) => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label}:${response.status}:${detail.slice(0, 300)}`);
  }
  return response.json();
};

export const listPortfolioRoots = async ({ projectId, accessToken, fetchImpl = fetch }) => {
  const documents = [];
  let pageToken = '';

  do {
    const url = new URL(`${baseUrl(projectId)}/portfolioStates`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.append('mask.fieldPaths', 'serviceJoinedAt');
    url.searchParams.append('mask.fieldPaths', 'joinedAt');
    url.searchParams.append('mask.fieldPaths', 'migrationComplete');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await readJson(await fetchImpl(url, {
      headers: authHeaders(accessToken),
    }), 'firestore-list-portfolio-roots-failed');
    documents.push(...(data.documents || []).map((document) => ({
      name: document.name,
      data: decodeFirestoreFields(document.fields || {}),
    })));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return documents;
};

export const queryCollectionGroup = async ({
  projectId,
  accessToken,
  collectionId,
  whereFieldPath = '',
  whereValue,
  fetchImpl = fetch,
}) => {
  const structuredQuery = {
    from: [{ collectionId, allDescendants: true }],
  };
  if (whereFieldPath) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: whereFieldPath },
        op: 'EQUAL',
        value: encodeFirestoreValue(whereValue),
      },
    };
  }
  const response = await fetchImpl(`${baseUrl(projectId)}:runQuery`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      structuredQuery,
    }),
  });
  const rows = await readJson(response, `firestore-query-${collectionId}-failed`);
  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((document) => ({
      name: document.name,
      data: decodeFirestoreFields(document.fields || {}),
    }));
};

export const getPortfolioUserId = (documentName) => {
  const match = String(documentName || '').match(/\/documents\/portfolioStates\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
};

export const commitPortfolioSnapshots = async ({
  projectId,
  accessToken,
  snapshots,
  fetchImpl = fetch,
}) => {
  let committed = 0;
  for (let start = 0; start < snapshots.length; start += COMMIT_WRITE_LIMIT) {
    const chunk = snapshots.slice(start, start + COMMIT_WRITE_LIMIT);
    const response = await fetchImpl(`${baseUrl(projectId)}:commit`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        writes: chunk.map(({ userId, id, data }) => ({
          update: {
            name: `${documentRoot(projectId)}/portfolioStates/${encodeURIComponent(userId)}/portfolioSnapshots/${encodeURIComponent(id)}`,
            fields: encodeFirestoreFields(data),
          },
        })),
      }),
    });
    await readJson(response, 'firestore-commit-snapshots-failed');
    committed += chunk.length;
  }
  return committed;
};
