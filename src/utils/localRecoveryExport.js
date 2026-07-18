import {
  AUTO_DIVIDENDS_STORAGE_KEY,
  ASSETS_STORAGE_KEY,
  CONFIRMED_DIVIDENDS_STORAGE_KEY,
  DEFAULT_PORTFOLIO_NAME,
  DIVIDEND_ASSET_REGISTRY_STORAGE_KEY,
  MEMOS_STORAGE_KEY,
  PORTFOLIO_NAME_STORAGE_KEY,
  TARGET_PORTFOLIO_STORAGE_KEY,
  TRADE_LEDGER_STORAGE_KEY,
  TRADES_STORAGE_KEY,
} from '../constants.js';

const readJson = (storage, key, fallback) => {
  try {
    const saved = storage.getItem(key);
    return saved === null ? fallback : JSON.parse(saved);
  } catch {
    return fallback;
  }
};

export const buildLegacyLocalSnapshot = (storage) => ({
  portfolioName: readJson(storage, PORTFOLIO_NAME_STORAGE_KEY, DEFAULT_PORTFOLIO_NAME),
  assets: readJson(storage, ASSETS_STORAGE_KEY, []),
  trades: readJson(storage, TRADES_STORAGE_KEY, []),
  memos: readJson(storage, MEMOS_STORAGE_KEY, []),
  tradeLedger: readJson(storage, TRADE_LEDGER_STORAGE_KEY, []),
  autoDividends: readJson(storage, AUTO_DIVIDENDS_STORAGE_KEY, []),
  confirmedDividends: readJson(storage, CONFIRMED_DIVIDENDS_STORAGE_KEY, []),
  dividendAssetRegistry: readJson(storage, DIVIDEND_ASSET_REGISTRY_STORAGE_KEY, []),
  targetPortfolio: readJson(storage, TARGET_PORTFOLIO_STORAGE_KEY, {}),
});

export const summarizeLocalSnapshot = (snapshot = {}) => {
  const records = [
    ...(snapshot.assets || []),
    ...(snapshot.trades || []),
    ...(snapshot.memos || []),
    ...(snapshot.tradeLedger || []),
  ];
  const latestTimestamp = records.reduce((latest, row) => {
    const timestamp = Date.parse(row?.updatedAt || row?.createdAt || '');
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);

  return {
    assetCount: Array.isArray(snapshot.assets) ? snapshot.assets.length : 0,
    ledgerCount: Array.isArray(snapshot.tradeLedger) ? snapshot.tradeLedger.length : 0,
    memoCount: Array.isArray(snapshot.memos) ? snapshot.memos.length : 0,
    latestUpdatedAt: latestTimestamp ? new Date(latestTimestamp).toISOString() : '',
  };
};
