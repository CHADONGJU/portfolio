// 클라우드 저장에 실패했을 때의 로컬 저널.
// 저장하지 못한 변경을 남겨 두었다가 다음 접속에서 합친다. 네트워크가 끊긴
// 채로 입력한 매매가 사라지지 않게 하는 마지막 안전망이다.
import {
  arePortfolioSnapshotsEquivalent,
  PORTFOLIO_COLLECTION_FIELDS,
  stableSerialize,
} from './portfolioSnapshotComparison.js';
import { getScopedStorageKey, loadJson, saveJson } from './storage.js';

const JOURNAL_KEY = 'portfolio_sync_journal_v1';
const ROOT_FIELDS = ['portfolioName', 'targetPortfolio'];
const equal = (left, right) => stableSerialize(left) === stableSerialize(right);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rowKey = (row) => row?.id != null ? `id:${row.id}`
  : row?.sourceId ? `source:${row.sourceId}` : `value:${stableSerialize(row)}`;

// Apply only local changes relative to the last acknowledged snapshot. Remote
// additions and unrelated field edits survive; both values of a conflict are
// retained in the journal, including intentional local deletions.
const mergeValue = (base, local, remote, path, conflicts) => {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const maps = [base, local, remote].map((rows) => new Map(rows.map((row) => [rowKey(row), row])));
    const keys = new Set([...maps[2].keys(), ...maps[1].keys(), ...maps[0].keys()]);
    return [...keys].flatMap((key) => {
      const merged = mergeValue(...maps.map((map) => map.get(key)), `${path}/${key}`, conflicts);
      return merged === undefined ? [] : [merged];
    });
  }
  if (isObject(base) && isObject(local) && isObject(remote)) {
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])]
      .flatMap((key) => {
        const merged = mergeValue(base[key], local[key], remote[key], `${path}/${key}`, conflicts);
        return merged === undefined ? [] : [[key, merged]];
      }));
  }
  conflicts.push({ path, base: base ?? null, local: local ?? null, remote: remote ?? null });
  return local;
};

export const mergePendingPortfolio = (base, local, remote) => {
  const conflicts = [];
  const snapshot = { ...remote };
  for (const field of [...PORTFOLIO_COLLECTION_FIELDS, ...ROOT_FIELDS]) {
    const fallback = PORTFOLIO_COLLECTION_FIELDS.includes(field) ? [] : field === 'targetPortfolio' ? {} : '';
    snapshot[field] = mergeValue(base?.[field] ?? fallback, local?.[field] ?? fallback,
      remote?.[field] ?? fallback, field, conflicts);
  }
  return { snapshot, conflicts };
};

export const readPortfolioJournal = (scope) => {
  const journal = loadJson(getScopedStorageKey(JOURNAL_KEY, scope), null);
  return journal?.version === 1 && isObject(journal.local) ? journal : null;
};

export const writePortfolioJournal = (scope, journal) => (
  saveJson(getScopedStorageKey(JOURNAL_KEY, scope), journal)
);

export const hasPendingPortfolio = (journal) => Boolean(journal && (
  !journal.base || !arePortfolioSnapshotsEquivalent(journal.base, journal.local)
));

export const appendPortfolioRecovery = (recoveries = [], recovery) => {
  // Repeated reconnects must not duplicate the same recovery data.
  const signature = stableSerialize(recovery);
  return recoveries.some((entry) => stableSerialize(entry) === signature)
    ? recoveries : [...recoveries, recovery];
};
