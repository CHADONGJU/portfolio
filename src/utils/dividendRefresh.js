export const DIVIDEND_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const normalizeTicker = (ticker = '') => String(ticker || '').trim().toUpperCase();

const isRecordForAsset = (record = {}, asset = {}) => {
  const assetId = asset.id === undefined || asset.id === null ? '' : String(asset.id);
  const recordAssetId = record.assetId === undefined || record.assetId === null
    ? ''
    : String(record.assetId);
  if (assetId && recordAssetId && assetId === recordAssetId) return true;

  const assetTicker = normalizeTicker(asset.ticker);
  const recordTicker = normalizeTicker(record.ticker);
  if (assetTicker && recordTicker && assetTicker === recordTicker) return true;

  return Boolean(asset.name && record.name && asset.name === record.name);
};

export const getDividendHoldingRevision = (asset = {}, ledger = []) => {
  const relatedRows = ledger
    .filter((record) => isRecordForAsset(record, asset))
    .map((record) => [
      record.id || record.sourceId || '',
      record.side || record.type || record.action || '',
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
    ...relatedRows,
  ].join('|');
};

export const findDividendRegistryEntry = (registry = [], asset = {}) => {
  const assetId = asset.id === undefined || asset.id === null ? '' : String(asset.id);
  const ticker = normalizeTicker(asset.ticker);

  return registry.find((entry) => {
    const entryAssetId = entry.assetId === undefined || entry.assetId === null
      ? ''
      : String(entry.assetId);
    if (assetId && entryAssetId && assetId === entryAssetId) return true;
    if (ticker && normalizeTicker(entry.ticker) === ticker) return true;
    return Boolean(asset.name && entry.name === asset.name);
  }) || null;
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
