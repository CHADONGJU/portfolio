import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { assertSafePortfolioWrite } from '../utils/portfolioWriteSafety';
import { arePortfolioRootFieldsEquivalent } from '../utils/portfolioSnapshotComparison';

const SCHEMA_VERSION = 2;
const BATCH_LIMIT = 400;

const COLLECTION_FIELDS = [
  'assets',
  'trades',
  'memos',
  'tradeLedger',
  'autoDividends',
  'confirmedDividends',
  'dividendAssetRegistry',
];

const cleanForFirestore = (value) => JSON.parse(JSON.stringify(value));

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
  if (record.id !== undefined && record.id !== null && String(record.id)) {
    return `${field}:${String(record.id)}`;
  }
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

const toDocumentMap = (field, rows = []) => new Map(
  rows.map((record, index) => {
    const identity = getRecordIdentity(field, record, index);
    return [`${field}-${hashIdentity(identity)}`, cleanForFirestore(record)];
  }),
);

const buildRootMetadata = (snapshot = {}, userEmail = '') => ({
  schemaVersion: SCHEMA_VERSION,
  migrationComplete: true,
  portfolioName: snapshot.portfolioName || '',
  targetPortfolio: cleanForFirestore(snapshot.targetPortfolio || {}),
  userEmail,
  updatedAt: serverTimestamp(),
});

const commitOperations = async (database, operations = []) => {
  for (let start = 0; start < operations.length; start += BATCH_LIMIT) {
    const batch = writeBatch(database);
    operations.slice(start, start + BATCH_LIMIT).forEach((operation) => operation(batch));
    await batch.commit();
  }
};

const readCollectionRows = async (database, userId, field) => {
  const snapshot = await getDocs(collection(database, 'portfolioStates', userId, field));
  return snapshot.docs.map((entry) => entry.data());
};

const getPortfolioRevision = (snapshotData = {}) => {
  const updatedAt = snapshotData?.updatedAt;
  if (typeof updatedAt?.toMillis === 'function') return String(updatedAt.toMillis());
  if (Number.isFinite(updatedAt?.seconds)) {
    return `${updatedAt.seconds}:${updatedAt.nanoseconds || 0}`;
  }
  return '';
};

export const loadPortfolioState = async (database, userId) => {
  const rootRef = doc(database, 'portfolioStates', userId);
  const rootSnapshot = await getDoc(rootRef);
  if (!rootSnapshot.exists()) {
    return { exists: false, data: null, needsMigration: false, revision: '' };
  }

  const rootData = rootSnapshot.data();
  if (rootData.schemaVersion !== SCHEMA_VERSION || rootData.migrationComplete !== true) {
    return {
      exists: true,
      data: rootData,
      needsMigration: true,
      revision: getPortfolioRevision(rootData),
    };
  }

  const collectionEntries = await Promise.all(
    COLLECTION_FIELDS.map(async (field) => [field, await readCollectionRows(database, userId, field)]),
  );

  return {
    exists: true,
    needsMigration: false,
    revision: getPortfolioRevision(rootData),
    data: {
      ...rootData,
      ...Object.fromEntries(collectionEntries),
    },
  };
};

export const subscribePortfolioState = (database, userId, onChange, onError) => (
  onSnapshot(
    doc(database, 'portfolioStates', userId),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return;
      onChange({
        exists: snapshot.exists(),
        revision: snapshot.exists() ? getPortfolioRevision(snapshot.data()) : '',
      });
    },
    onError,
  )
);

export const migratePortfolioState = async (database, userId, snapshot, userEmail = '') => {
  const rootRef = doc(database, 'portfolioStates', userId);

  await setDoc(rootRef, {
    schemaVersion: SCHEMA_VERSION,
    migrationComplete: false,
    userEmail,
    migrationStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const existingCollectionSnapshots = await Promise.all(
    COLLECTION_FIELDS.map((field) => getDocs(collection(database, 'portfolioStates', userId, field))),
  );
  await commitOperations(
    database,
    existingCollectionSnapshots.flatMap((snapshot) => (
      snapshot.docs.map((entry) => (batch) => batch.delete(entry.ref))
    )),
  );

  const operations = COLLECTION_FIELDS.flatMap((field) => (
    [...toDocumentMap(field, snapshot[field] || []).entries()].map(([documentId, record]) => (
      (batch) => batch.set(doc(database, 'portfolioStates', userId, field, documentId), record)
    ))
  ));

  await commitOperations(database, operations);

  await setDoc(rootRef, {
    ...buildRootMetadata(snapshot, userEmail),
    migrationCompletedAt: serverTimestamp(),
    ...Object.fromEntries(COLLECTION_FIELDS.map((field) => [field, deleteField()])),
  }, { merge: true });
};

export const savePortfolioStateDiff = async (
  database,
  userId,
  nextSnapshot,
  previousSnapshot = null,
  userEmail = '',
  options = {},
) => {
  if (options.allowDestructive !== true) {
    assertSafePortfolioWrite(previousSnapshot, nextSnapshot);
  }
  const operations = [];

  COLLECTION_FIELDS.forEach((field) => {
    const previousDocuments = toDocumentMap(field, previousSnapshot?.[field] || []);
    const nextDocuments = toDocumentMap(field, nextSnapshot?.[field] || []);

    nextDocuments.forEach((record, documentId) => {
      const previousRecord = previousDocuments.get(documentId);
      if (previousRecord && JSON.stringify(previousRecord) === JSON.stringify(record)) return;
      operations.push(
        (batch) => batch.set(doc(database, 'portfolioStates', userId, field, documentId), record),
      );
    });

    previousDocuments.forEach((_, documentId) => {
      if (nextDocuments.has(documentId)) return;
      operations.push(
        (batch) => batch.delete(doc(database, 'portfolioStates', userId, field, documentId)),
      );
    });
  });

  const rootFieldsChanged = !previousSnapshot
    || !arePortfolioRootFieldsEquivalent(previousSnapshot, nextSnapshot);
  if (operations.length === 0 && !rootFieldsChanged) {
    return { changed: false, operationCount: 0 };
  }

  await commitOperations(database, operations);
  await setDoc(
    doc(database, 'portfolioStates', userId),
    buildRootMetadata(nextSnapshot, userEmail),
    { merge: true },
  );
  return { changed: true, operationCount: operations.length };
};
