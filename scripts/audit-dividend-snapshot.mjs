import fs from 'node:fs';
import path from 'node:path';

import {
  fetchDividends,
  fetchUsdKrwRateQuoteByDate,
} from '../src/services/marketData.js';
import {
  buildAutoDividendRows,
  buildDividendAssetUniverse,
  getAssetDividendProfile,
  getDividendStartDate,
} from '../src/utils/dividendCalculations.js';

const [, , snapshotPath, ...cliArguments] = process.argv;
const outputFlagIndex = cliArguments.indexOf('--output-backup');
const outputBackupPath = outputFlagIndex >= 0 ? cliArguments[outputFlagIndex + 1] : '';
const requestedTickers = cliArguments.filter((_, index) => (
  index !== outputFlagIndex && index !== outputFlagIndex + 1
));

if (!snapshotPath || (outputFlagIndex >= 0 && !outputBackupPath)) {
  throw new Error('Usage: node scripts/audit-dividend-snapshot.mjs <snapshot.json> [ticker ...] [--output-backup <output.json>]');
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
const usdRateRequests = new Map();
const todayKey = new Date().toISOString().slice(0, 10);

const getUsdRateQuote = (date) => {
  if (!usdRateRequests.has(date)) {
    usdRateRequests.set(date, fetchUsdKrwRateQuoteByDate(date));
  }
  return usdRateRequests.get(date);
};

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
  const rowsWithRates = await Promise.all(calculatedRows.map(async (row) => {
    if (String(row.currency || '').toUpperCase() !== 'USD') return {
      ...row,
      amountKRW: Number(row.amount) || 0,
      krwExchangeRate: 1,
      krwExchangeRateDate: row.paymentDate || row.exDate,
      krwExchangeRateSource: 'native-krw',
      krwExchangeRateBasis: 'native',
    };

    const paymentDate = row.actualPaymentDate || row.paymentDate || '';
    const hasCompletedPaymentDate = Boolean(paymentDate && paymentDate <= todayKey);
    const rateDate = hasCompletedPaymentDate
      ? paymentDate
      : row.exDate || row.date;
    const quote = await getUsdRateQuote(rateDate);
    const rate = Number(quote?.rate) || 0;
    return {
      ...row,
      amountKRW: (Number(row.amount) || 0) * rate,
      krwExchangeRate: rate,
      krwExchangeRateDate: String(quote?.asOf || rateDate).slice(0, 10),
      krwExchangeRateSource: quote?.source || '',
      krwExchangeRateBasis: hasCompletedPaymentDate ? 'payment-date' : 'ex-date',
    };
  }));

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
    earnedRows: rowsWithRates.length,
    grossAmount: rowsWithRates.reduce((sum, row) => sum + Number(row.grossAmount || 0), 0),
    netAmount: rowsWithRates.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    netAmountKRW: rowsWithRates.reduce((sum, row) => sum + Number(row.amountKRW || 0), 0),
    currency: asset.originalCurrency || asset.currency || 'KRW',
    rows: rowsWithRates.map((row) => ({
      exDate: row.exDate,
      quantity: row.quantity,
      perShareGrossAmount: row.perShareGrossAmount,
      grossAmount: row.grossAmount,
      taxAmount: row.taxAmount,
      feeAmount: row.feeAmount,
      amount: row.amount,
      amountKRW: row.amountKRW,
      krwExchangeRate: row.krwExchangeRate,
      krwExchangeRateDate: row.krwExchangeRateDate,
      krwExchangeRateSource: row.krwExchangeRateSource,
    })),
    calculatedRows: rowsWithRates,
  };
}));

const automaticDividends = results.flatMap((result) => result.calculatedRows);
const missingUsdRates = automaticDividends.filter((row) => (
  String(row.currency || '').toUpperCase() === 'USD' && !(Number(row.krwExchangeRate) > 0)
));
if (missingUsdRates.length > 0) {
  throw new Error(`Historical USD/KRW rate unavailable for ${missingUsdRates.length} dividend row(s)`);
}

let writtenBackupPath = '';
if (outputBackupPath) {
  writtenBackupPath = path.resolve(outputBackupPath);
  fs.mkdirSync(path.dirname(writtenBackupPath), { recursive: true });
  const outputBackup = {
    kind: backup.kind || 'my-portfolio-backup',
    version: backup.version || 1,
    exportedAt: new Date().toISOString(),
    recoverySource: 'dynamic-dividend-recalculation',
    data: {
      ...data,
      autoDividends: automaticDividends,
      confirmedDividends: (Array.isArray(data.confirmedDividends) ? data.confirmedDividends : [])
        .filter((row) => row.confirmationSource !== 'user-photo-record'),
    },
  };
  fs.writeFileSync(writtenBackupPath, `${JSON.stringify(outputBackup, null, 2)}\n`, 'utf8');
}

const totals = results.reduce((summary, result) => {
  const currency = String(result.currency || 'KRW').toUpperCase();
  summary.byCurrency[currency] = (summary.byCurrency[currency] || 0) + result.netAmount;
  summary.krwConverted += result.netAmountKRW;
  summary.earnedRows += result.earnedRows;
  return summary;
}, { byCurrency: {}, krwConverted: 0, earnedRows: 0 });

console.log(JSON.stringify({
  snapshot: absolutePath,
  writtenBackupPath,
  assetCount: selectedAssets.length,
  ledgerCount: ledger.length,
  totals,
  results: results.map(({ calculatedRows, ...result }) => result),
}, null, 2));
