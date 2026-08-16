import { getDividendReportingDate } from './dividendDates.js';
import { normalizeAccountType } from './accountTypes.js';

const normalizeTicker = (ticker = '') => String(ticker || '').trim().toUpperCase();
const isDeletedDividendRecord = (dividend = {}) => Boolean(dividend.deletedAt || dividend.status === 'deleted');

const getRecordTimestamp = (dividend = {}) => {
  const value = dividend.deletedAt
    || dividend.sourceCheckedAt
    || dividend.updatedAt
    || dividend.createdAt
    || '';
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/**
 * 배당 이벤트 하나를 식별하는 키.
 * 계좌 유형까지 들어가야 한다 — 이 키가 mergeAutomaticDividendRecords에서 어떤
 * 기록이 살아남을지 정하기 때문에, 계좌를 빼면 ISA분과 일반계좌분 중 한쪽이
 * 조용히 사라진다.
 */
export const getAutomaticDividendEventKey = (dividend = {}) => [
  normalizeTicker(dividend.ticker) || String(dividend.name || '').trim().toUpperCase(),
  normalizeAccountType(dividend.accountType),
  Number(dividend.round) || 1,
  dividend.exDate || dividend.date || '',
].join('::');

// 같은 종목이라도 계좌 유형이 다르면 과세가 다른 별개의 보유분이다.
// 계좌를 빼고 묶으면 ISA분과 일반계좌분이 한 건으로 합쳐지면서 한쪽이 사라진다.
const getAutomaticDividendAssetKey = (dividend = {}) => [
  normalizeTicker(dividend.ticker) || String(dividend.name || '').trim().toUpperCase(),
  normalizeAccountType(dividend.accountType),
].join('::');

const getDateDistanceInDays = (left = '', right = '') => {
  const leftTimestamp = Date.parse(`${String(left || '').slice(0, 10)}T00:00:00Z`);
  const rightTimestamp = Date.parse(`${String(right || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) return Infinity;
  return Math.abs(leftTimestamp - rightTimestamp) / (24 * 60 * 60 * 1000);
};

export const isSameAutomaticDividendEvent = (left = {}, right = {}) => {
  if (getAutomaticDividendAssetKey(left) !== getAutomaticDividendAssetKey(right)) return false;

  const leftExDate = left.exDate || left.date || '';
  const rightExDate = right.exDate || right.date || '';
  if (leftExDate && rightExDate) {
    // A provider can correct a provisional ex/record date by a few days. A security
    // cannot have two independent dividend cycles this close together, so the
    // official refresh replaces the provisional row instead of being appended.
    return getDateDistanceInDays(leftExDate, rightExDate) <= 7;
  }

  return getDateDistanceInDays(
    left.actualPaymentDate || left.paymentDate,
    right.actualPaymentDate || right.paymentDate,
  ) <= 7;
};

const getAutomaticDividendSourcePriority = (dividend = {}) => {
  const source = String(dividend.calculationSource || dividend.source || '').toLowerCase();
  if (/kodex|tiger|jpm-adr/.test(source)) return 4;
  if (/stockanalysis/.test(source)) return 3;
  if (dividend.paymentDate || dividend.actualPaymentDate) return 2;
  return 1;
};

const preferAutomaticDividendRecord = (candidate = {}, existing = {}) => {
  const priorityDelta = getAutomaticDividendSourcePriority(candidate)
    - getAutomaticDividendSourcePriority(existing);
  if (priorityDelta !== 0) return priorityDelta > 0 ? candidate : existing;
  const timestampDelta = getRecordTimestamp(candidate) - getRecordTimestamp(existing);
  if (timestampDelta !== 0) return timestampDelta > 0 ? candidate : existing;

  const amountDelta = (Number(candidate.amount) || 0) - (Number(existing.amount) || 0);
  if (amountDelta !== 0) return amountDelta > 0 ? candidate : existing;

  return (Number(candidate.quantity) || 0) >= (Number(existing.quantity) || 0)
    ? candidate
    : existing;
};

const collapseEquivalentAutomaticDividendRecords = (records = []) => {
  const collapsed = [];
  records.forEach((record) => {
    const equivalentIndex = collapsed.findIndex((candidate) => (
      isSameAutomaticDividendEvent(candidate, record)
    ));
    if (equivalentIndex < 0) {
      collapsed.push(record);
      return;
    }
    collapsed[equivalentIndex] = preferAutomaticDividendRecord(record, collapsed[equivalentIndex]);
  });
  return collapsed;
};

/**
 * Provider refreshes are append-safe: a short or temporarily incomplete source
 * may update events it returned, but must not erase older unrelated events.
 * Events explicitly present in the provider response can still be invalidated
 * when the transaction ledger proves there was no entitlement.
 */
export const mergeAutomaticDividendRecords = (
  preferred = [],
  fallback = [],
  { activeAssetKeys = null, invalidatedEventKeys = [] } = {},
) => {
  const preferredByEvent = new Map();
  collapseEquivalentAutomaticDividendRecords(preferred).forEach((record) => {
    const key = getAutomaticDividendEventKey(record);
    const existing = preferredByEvent.get(key);
    if (!existing || getRecordTimestamp(record) >= getRecordTimestamp(existing)) {
      preferredByEvent.set(key, record);
    }
  });

  const invalidated = new Set(invalidatedEventKeys);
  const activeKeys = activeAssetKeys ? new Set(activeAssetKeys) : null;
  const mergedByEvent = new Map(preferredByEvent);

  fallback.forEach((record) => {
    const assetKey = normalizeTicker(record.ticker)
      || String(record.name || '').trim().toUpperCase();
    const eventKey = getAutomaticDividendEventKey(record);
    if (activeKeys && !activeKeys.has(assetKey)) return;
    if (
      preferredByEvent.has(eventKey)
      || invalidated.has(eventKey)
      || [...preferredByEvent.values()].some((preferredRecord) => (
        isSameAutomaticDividendEvent(preferredRecord, record)
      ))
    ) return;

    const equivalentEntry = [...mergedByEvent.entries()].find(([, candidate]) => (
      isSameAutomaticDividendEvent(candidate, record)
    ));
    if (equivalentEntry) {
      const [equivalentKey, existing] = equivalentEntry;
      mergedByEvent.set(equivalentKey, preferAutomaticDividendRecord(record, existing));
      return;
    }

    mergedByEvent.set(eventKey, record);
  });

  return [...mergedByEvent.values()].sort((left, right) => (
    getDividendReportingDate(right).localeCompare(getDividendReportingDate(left))
  ));
};

const getKoreaDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

export const getDividendRecordIdentity = (dividend = {}) => {
  if (dividend.id !== undefined && dividend.id !== null && String(dividend.id)) {
    return `id:${String(dividend.id)}`;
  }

  return [
    normalizeTicker(dividend.ticker) || String(dividend.name || '').trim().toUpperCase(),
    dividend.actualPaymentDate || dividend.paymentDate || dividend.date || dividend.period || '',
    dividend.currency || '',
    dividend.quantity || '',
    dividend.amount || '',
  ].join('::');
};

/**
 * Confirmed receipts are append-only across devices. Deletion is represented by a
 * tombstone, so an empty/stale cloud collection cannot erase valid local history.
 */
export const mergeDividendRecords = (preferred = [], fallback = []) => {
  const records = new Map();

  [...fallback, ...preferred].forEach((record) => {
    const key = getDividendRecordIdentity(record);
    const existing = records.get(key);
    if (!existing || getRecordTimestamp(record) >= getRecordTimestamp(existing)) {
      records.set(key, record);
    }
  });

  return [...records.values()];
};

export const isConfirmedDividendRecord = (dividend = {}) => (
  !isDeletedDividendRecord(dividend)
  && (Boolean(dividend.confirmationSource)
  || ['actual', 'confirmed', 'paid'].includes(String(dividend.status || '').toLowerCase())
  || ['actual', 'confirmed'].includes(String(dividend.recordType || '').toLowerCase()))
);

/**
 * A legacy photo import incorrectly labelled the user's KODEX 453810 receipt
 * as TIGER 453870. Keep the amount for audit, but remove the false security
 * assignment instead of silently moving it to another ticker.
 */
export const normalizeDividendValidationRecords = (dividends = []) => (
  dividends.map((dividend) => {
    const isIncorrectLegacyMapping = (
      dividend.id === 'photo-krw-2'
      && dividend.confirmationSource === 'user-photo-record'
      && String(dividend.ticker || '').trim() === '453870'
    );
    if (!isIncorrectLegacyMapping) return dividend;

    return {
      ...dividend,
      ticker: '',
      name: '원화 배당(종목 확인 필요)',
      validationStatus: 'unassigned',
      mappingCorrection: 'removed-incorrect-453870-assignment',
    };
  })
);

export const selectReceivedDividendRecords = (dividends = [], today = getKoreaDateKey()) => (
  dividends.filter((dividend) => {
    if (isDeletedDividendRecord(dividend) || !Number.isFinite(Number(dividend.amount))) return false;
    if (isConfirmedDividendRecord(dividend)) {
      return Boolean(dividend.actualPaymentDate || dividend.paymentDate || dividend.date || dividend.period);
    }

    // Formula rows are counted only after the official payment date and only when
    // their record-date holdings were verified from the transaction ledger.
    const paymentDate = getDividendReportingDate(dividend);
    const currency = String(dividend.currency || '').toUpperCase();
    const canUseExDividendDate = currency === 'KRW';
    if (!dividend.actualPaymentDate && !dividend.paymentDate && !canUseExDividendDate) return false;
    return Boolean(dividend.entitlementVerified && paymentDate && paymentDate <= today);
  })
);

const getAssetKey = (dividend = {}) => (
  normalizeTicker(dividend.ticker)
  || String(dividend.name || '').trim().toUpperCase()
);

const getPeriodKey = (dividend = {}) => {
  const explicitPeriod = String(dividend.period || '').trim();
  if (/^\d{4}-\d{2}$/.test(explicitPeriod)) return explicitPeriod;

  const reportingDate = getDividendReportingDate(dividend);
  return /^\d{4}-\d{2}/.test(reportingDate) ? reportingDate.slice(0, 7) : '';
};

/**
 * Display totals are formula-only. Imported/photo receipts remain available as
 * a validation set, but are never appended to the calculated cash total.
 */
export const selectFormulaDividendRecords = (automaticDividends = []) => (
  collapseEquivalentAutomaticDividendRecords(automaticDividends)
    .filter((dividend) => !isDeletedDividendRecord(dividend))
    .sort((left, right) => (
      getDividendReportingDate(right).localeCompare(getDividendReportingDate(left))
    ))
);

/**
 * Only receipts entered explicitly through the app may affect displayed totals.
 * Legacy photo/import rows remain an audit set and must never be added as cash.
 */
export const selectUserEnteredDividendRecords = (confirmedDividends = []) => (
  confirmedDividends.filter((dividend) => (
    isConfirmedDividendRecord(dividend)
    && dividend.confirmationSource === 'user-entry'
  ))
);

export const sortDividendRecordsNewestFirst = (dividends = []) => (
  [...dividends].sort((left, right) => {
    const reportingOrder = getDividendReportingDate(right)
      .localeCompare(getDividendReportingDate(left));
    if (reportingOrder !== 0) return reportingOrder;
    return String(right.exDate || right.date || right.id || '')
      .localeCompare(String(left.exDate || left.date || left.id || ''));
  })
);

/**
 * 같은 종목·같은 지급월에 실제 입금 기록이 있으면 자동 계산값을 대체한다.
 * 다른 달 또는 다른 종목의 자동 계산값은 그대로 유지한다.
 */
export const selectReportedDividendRecords = (
  automaticDividends = [],
  confirmedDividends = [],
) => {
  const activeAutomaticDividends = collapseEquivalentAutomaticDividendRecords(
    automaticDividends.filter((dividend) => !isDeletedDividendRecord(dividend)),
  );
  const activeConfirmedDividends = confirmedDividends.filter((dividend) => !isDeletedDividendRecord(dividend));
  const confirmedPeriods = new Set(activeConfirmedDividends.map((dividend) => (
    `${getAssetKey(dividend)}::${getPeriodKey(dividend)}`
  )));
  const confirmedAssets = new Set(activeConfirmedDividends.map(getAssetKey));
  const exactPeriodMatches = new Set();
  let remainingAutomatic = activeAutomaticDividends.filter((dividend) => {
    const assetKey = getAssetKey(dividend);
    const periodKey = getPeriodKey(dividend);
    if (!assetKey) return true;
    if (!periodKey) return !confirmedAssets.has(assetKey);
    const eventKey = `${assetKey}::${periodKey}`;
    if (!confirmedPeriods.has(eventKey)) return true;
    exactPeriodMatches.add(eventKey);
    return false;
  });

  // 과거 사진 기록은 증권사 입금월로 묶여 있고, 공식 지급일이 월말이면
  // 자동 데이터보다 다음 달로 기록된 사례가 있다(PG 등). 금액이 거의
  // 같은 인접 월 한 건도 같은 실제 지급으로 간주해 중복 합산을 막는다.
  const adjacentMatchIndexes = new Set();
  activeConfirmedDividends.forEach((confirmed) => {
    const assetKey = getAssetKey(confirmed);
    const periodKey = getPeriodKey(confirmed);
    if (!assetKey || !periodKey || exactPeriodMatches.has(`${assetKey}::${periodKey}`)) return;

    const [year, month] = periodKey.split('-').map(Number);
    const confirmedMonthIndex = year * 12 + month;
    const confirmedAmount = Number(confirmed.amount);
    let bestMatch = null;

    remainingAutomatic.forEach((automatic, index) => {
      if (adjacentMatchIndexes.has(index) || getAssetKey(automatic) !== assetKey) return;
      const automaticPeriod = getPeriodKey(automatic);
      if (!automaticPeriod) return;
      const [automaticYear, automaticMonth] = automaticPeriod.split('-').map(Number);
      const monthDistance = Math.abs(confirmedMonthIndex - (automaticYear * 12 + automaticMonth));
      if (monthDistance !== 1) return;

      const automaticAmount = Number(automatic.amount);
      const tolerance = Math.max(0.1, Math.abs(confirmedAmount) * 0.03);
      const amountDifference = Math.abs(confirmedAmount - automaticAmount);
      if (!Number.isFinite(amountDifference) || amountDifference > tolerance) return;
      if (!bestMatch || amountDifference < bestMatch.amountDifference) {
        bestMatch = { index, amountDifference };
      }
    });

    if (bestMatch) adjacentMatchIndexes.add(bestMatch.index);
  });
  remainingAutomatic = remainingAutomatic.filter((_, index) => !adjacentMatchIndexes.has(index));

  return [...activeConfirmedDividends, ...remainingAutomatic].sort((left, right) => (
    getDividendReportingDate(right).localeCompare(getDividendReportingDate(left))
  ));
};
