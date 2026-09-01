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
import { PORTFOLIO_COLLECTION_FIELDS, arePortfolioRootFieldsEquivalent } from '../utils/portfolioSnapshotComparison.js';
import { assertSafePortfolioWrite } from '../utils/portfolioWriteSafety.js';

const SCHEMA_VERSION = 2;
const BATCH_LIMIT = 400;

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
  if (field === 'dividendAssetRegistry') {
    return [
      field,
      record.assetId || '',
      String(record.ticker || '').trim().toUpperCase(),
      record.name || '',
    ].join('::');
  }

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

export const getPortfolioDocumentId = (field, record = {}, index = 0) => {
  if (field === 'portfolioSnapshots') {
    const date = String(record.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `snapshot-${date}`;
  }
  return `${field}-${hashIdentity(getRecordIdentity(field, record, index))}`;
};

const toDocumentMap = (field, rows = []) => new Map(
  rows.map((record, index) => {
    const documentId = getPortfolioDocumentId(field, record, index);
    return [documentId, cleanForFirestore(record)];
  }),
);

const buildRootMetadata = (snapshot = {}, userEmail = '') => ({
  schemaVersion: SCHEMA_VERSION,
  migrationComplete: true,
  portfolioName: snapshot.portfolioName || '',
  targetPortfolio: cleanForFirestore(snapshot.targetPortfolio || {}),
  userEmail,
  updatedAt: serverTimestamp(),
  ...Object.fromEntries(PORTFOLIO_COLLECTION_FIELDS.map((field) => [field, deleteField()])),
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

export const mergeRootAndCollectionState = (rootData = {}, collectionData = {}) => {
  const mergedCollections = Object.fromEntries(
    PORTFOLIO_COLLECTION_FIELDS.map((field) => [
      field,
      Array.isArray(collectionData[field]) ? collectionData[field] : [],
    ]),
  );
  let needsMigration = rootData.migrationComplete !== true;

  PORTFOLIO_COLLECTION_FIELDS.forEach((field) => {
    const legacyRows = Array.isArray(rootData[field]) ? rootData[field] : [];
    if (mergedCollections[field].length === 0 && legacyRows.length > 0) {
      mergedCollections[field] = legacyRows;
      needsMigration = true;
    }
  });

  return {
    data: {
      ...rootData,
      ...mergedCollections,
    },
    needsMigration,
  };
};

export const loadPortfolioState = async (database, userId) => {
  const rootSnapshot = await getDoc(doc(database, 'portfolioStates', userId));
  if (!rootSnapshot.exists()) {
    return { exists: false, data: null, needsMigration: false, revision: '' };
  }

  const rootData = rootSnapshot.data();
  if (rootData.schemaVersion !== SCHEMA_VERSION) {
    return {
      exists: true,
      data: rootData,
      needsMigration: true,
      revision: getPortfolioRevision(rootData),
    };
  }

  const collectionEntries = await Promise.all(
    PORTFOLIO_COLLECTION_FIELDS.map(async (field) => [
      field,
      await readCollectionRows(database, userId, field),
    ]),
  );
  const mergedState = mergeRootAndCollectionState(
    rootData,
    Object.fromEntries(collectionEntries),
  );

  return {
    exists: true,
    needsMigration: mergedState.needsMigration,
    revision: getPortfolioRevision(rootData),
    data: mergedState.data,
  };
};

/**
 * 서비스 가입일을 딱 1번만 기록한다. 레거시 필드명 joinedAt은 DB 호환을 위해
 * 유지하지만 TWR 가능 시작일로 직접 사용하지 않는다. 호출부가 이미 기존 값이
 * 없는 걸 확인하고 부르므로 여기서는 존재 여부를 다시 확인하지 않는다 — merge:true라
 * 다른 필드는 건드리지 않고, 이후의 일반 저장(buildRootMetadata)도 이 필드를 모르므로
 * 절대 덮어쓰지 않는다.
 */
export const saveJoinedAt = async (database, userId, joinedAt) => {
  await setDoc(doc(database, 'portfolioStates', userId), { joinedAt }, { merge: true });
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

  const existingCollectionSnapshots = await Promise.all(
    PORTFOLIO_COLLECTION_FIELDS.map(async (field) => [
      field,
      await getDocs(collection(database, 'portfolioStates', userId, field)),
    ]),
  );

  /**
   * 마이그레이션도 원격 문서를 지운다. 루트 문서만 없고 서브컬렉션은 남아 있는 상태
   * (첫 마이그레이션이 중간에 끊기면 정확히 이 모양이 된다)에서 빈 로컬 스냅샷으로
   * 이 함수가 돌면 남아 있던 기록이 전부 삭제된다. 원격에 실제로 들어 있는 내용을
   * '이전 상태'로 삼아 저장 안전장치를 통과할 때만 진행한다. 아무것도 건드리기 전에
   * 검사해야 실패해도 원격이 중간 상태로 남지 않는다.
   */
  const remoteSnapshot = Object.fromEntries(
    existingCollectionSnapshots.map(([field, snapshotResult]) => [
      field,
      snapshotResult.docs.map((entry) => entry.data()),
    ]),
  );
  assertSafePortfolioWrite(remoteSnapshot, snapshot);

  await setDoc(rootRef, {
    schemaVersion: SCHEMA_VERSION,
    migrationComplete: false,
    userEmail,
    migrationStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const desiredDocumentIds = new Map();
  const writeOperations = PORTFOLIO_COLLECTION_FIELDS.flatMap((field) => {
    const documents = toDocumentMap(field, snapshot[field] || []);
    desiredDocumentIds.set(field, new Set(documents.keys()));
    return [...documents.entries()].map(([documentId, record]) => (
      (batch) => batch.set(doc(database, 'portfolioStates', userId, field, documentId), record)
    ));
  });
  const deleteOperations = existingCollectionSnapshots.flatMap(([field, snapshotResult]) => (
    snapshotResult.docs
      .filter((entry) => !desiredDocumentIds.get(field)?.has(entry.id))
      .map((entry) => (batch) => batch.delete(entry.ref))
  ));
  await commitOperations(database, [...writeOperations, ...deleteOperations]);

  await setDoc(rootRef, {
    ...buildRootMetadata(snapshot, userEmail),
    migrationCompletedAt: serverTimestamp(),
  }, { merge: true });
};

export const savePortfolioStateDiff = async (
  database,
  userId,
  nextSnapshot,
  previousSnapshot = null,
  userEmail = '',
) => {
  assertSafePortfolioWrite(previousSnapshot, nextSnapshot);
  const operations = [];

  PORTFOLIO_COLLECTION_FIELDS.forEach((field) => {
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
  const rootRef = doc(database, 'portfolioStates', userId);
  await setDoc(rootRef, buildRootMetadata(nextSnapshot, userEmail), { merge: true });

  /**
   * 방금 쓴 문서의 리비전을 돌려준다. 호출부가 이 값을 기억해두지 않으면,
   * 서버 ack이 도착했을 때 실시간 구독이 "모르는 리비전"으로 보고 포트폴리오
   * 전체(루트 + 서브컬렉션 7개)를 다시 내려받는다. 편집 한 번에 수천 건 읽기.
   * 루트 1건만 더 읽어서 그 재조회를 통째로 없앤다.
   */
  const savedRoot = await getDoc(rootRef);

  return {
    changed: true,
    operationCount: operations.length,
    revision: savedRoot.exists() ? getPortfolioRevision(savedRoot.data()) : '',
  };
};
