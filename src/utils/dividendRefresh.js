import { isRecordForAsset } from './assetIdentity.js';
import { getDividendLedgerRows, getDividendTradeSide } from './dividendHoldings.js';

export const DIVIDEND_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DIVIDEND_REFRESH_VERSION = 11;

const DIVIDEND_SOURCE_REFRESH_VERSION_BY_TICKER = new Map([
  ['277630', 12],
  ['453810', 11],
  ['477730', 11],
  // Force one clean rebuild for historical sold-position and monthly histories.
  ['QCOM', 9],
  ['JEPI', 9],
  // Visa is the only USD position affected by the Korea-date eligibility
  // boundary migration. Do not rewrite every USD asset for a KRW source fix.
  ['V', 9],
]);

const normalizeTicker = (ticker = '') => String(ticker || '').trim().toUpperCase();

export const getDividendRefreshVersion = (asset = {}) => {
  const ticker = normalizeTicker(asset.ticker).replace(/\.KS$/, '');
  return DIVIDEND_SOURCE_REFRESH_VERSION_BY_TICKER.get(ticker)
    || DIVIDEND_REFRESH_VERSION;
};

export const getDividendHoldingRevision = (asset = {}, ledger = []) => {
  const relatedRows = getDividendLedgerRows(asset, ledger)
    .map((record) => [
      record.id || record.sourceId || '',
      getDividendTradeSide(record),
      record.date || record.buyDate || record.sellDate || '',
      Number(record.quantity) || 0,
      Number(record.price ?? record.buyPrice ?? record.sellPrice) || 0,
    ].join(':'))
    .sort();

  return [
    asset.id ?? '',
    normalizeTicker(asset.ticker),
    asset.name || '',
    asset.buyDate || '',
    Number(asset.quantity) || 0,
    String(asset.accountType || 'GENERAL').trim().toUpperCase(),
    ...relatedRows,
  ].join('|');
};

export const findDividendRegistryEntry = (registry = [], asset = {}) => {
  return registry.find((entry) => isRecordForAsset(entry, asset)) || null;
};

export const getDividendRefreshState = ({
  asset = {},
  ledger = [],
  registry = [],
  now = Date.now(),
  intervalMs = DIVIDEND_REFRESH_INTERVAL_MS,
} = {}) => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const entry = findDividendRegistryEntry(registry, asset);
  if (!entry) return { shouldRefresh: true, holdingRevision, reason: 'missing' };
  if (entry.syncStatus === 'error') {
    return { shouldRefresh: true, holdingRevision, reason: 'previous-error' };
  }
  if (Number(entry.refreshVersion) !== getDividendRefreshVersion(asset)) {
    return { shouldRefresh: true, holdingRevision, reason: 'schema-changed' };
  }
  if (entry.holdingRevision !== holdingRevision) {
    return { shouldRefresh: true, holdingRevision, reason: 'holding-changed' };
  }

  const checkedAt = new Date(entry.checkedAt || 0).getTime();
  const nowTimestamp = new Date(now).getTime();
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) {
    return { shouldRefresh: true, holdingRevision, reason: 'unchecked' };
  }
  if (!Number.isFinite(nowTimestamp) || nowTimestamp - checkedAt >= intervalMs) {
    return { shouldRefresh: true, holdingRevision, reason: 'stale' };
  }

  return { shouldRefresh: false, holdingRevision, reason: 'fresh' };
};
