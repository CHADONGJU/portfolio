import fs from 'node:fs';
import path from 'node:path';

import { fetchDividends } from '../src/services/marketData.js';
import {
  buildAutoDividendRows,
  buildDividendAssetUniverse,
  getAssetDividendProfile,
  getDividendStartDate,
} from '../src/utils/dividendCalculations.js';

const [, , snapshotPath, ...requestedTickers] = process.argv;

if (!snapshotPath) {
  throw new Error('Usage: node scripts/audit-dividend-snapshot.mjs <snapshot.json> [ticker ...]');
}

const absolutePath = path.resolve(snapshotPath);
const backup = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
const data = backup.data || backup;
const assets = Array.isArray(data.assets) ? data.assets : [];
const ledger = Array.isArray(data.tradeLedger) ? data.tradeLedger : [];
const dividendAssets = buildDividendAssetUniverse(assets, ledger);
const tickerFilter = new Set(requestedTickers.map((ticker) => ticker.toUpperCase()));
const selectedAssets = tickerFilter.size > 0
  ? dividendAssets.filter((asset) => tickerFilter.has(String(asset.ticker || '').toUpperCase()))
  : dividendAssets;

const results = await Promise.all(selectedAssets.map(async (asset) => {
  const profile = getAssetDividendProfile(asset);
  const result = await fetchDividends({
    ...asset,
    securityType: asset.securityType || profile.securityType,
    forceRefresh: true,
  });
  const sourceRows = Object.values(result?.dividends || {});
  const startDate = getDividendStartDate(asset, ledger);
  const calculatedRows = buildAutoDividendRows({
    asset,
    ledger,
    dividends: result?.dividends || {},
    dividendStartDate: startDate,
  });

  return {
    name: asset.name,
    ticker: asset.ticker,
    category: asset.category,
    quantity: asset.quantity,
    startDate,
    status: result?.status || 'error',
    source: result?.source || '',
    sourceTicker: result?.sourceTicker || '',
    sourceRows: sourceRows.length,
    sourceFirstExDate: sourceRows.length > 0
      ? new Date(Math.min(...sourceRows.map((row) => Number(row.date))) * 1000).toISOString().slice(0, 10)
      : '',
    sourceLastExDate: sourceRows.length > 0
      ? new Date(Math.max(...sourceRows.map((row) => Number(row.date))) * 1000).toISOString().slice(0, 10)
      : '',
    earnedRows: calculatedRows.length,
    grossAmount: calculatedRows.reduce((sum, row) => sum + Number(row.grossAmount || 0), 0),
    netAmount: calculatedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    currency: asset.originalCurrency || asset.currency || 'KRW',
    rows: calculatedRows.map((row) => ({
      exDate: row.exDate,
      quantity: row.quantity,
      perShareGrossAmount: row.perShareGrossAmount,
      grossAmount: row.grossAmount,
      taxAmount: row.taxAmount,
      feeAmount: row.feeAmount,
      amount: row.amount,
    })),
  };
}));

console.log(JSON.stringify({
  snapshot: absolutePath,
  assetCount: selectedAssets.length,
  ledgerCount: ledger.length,
  results,
}, null, 2));
