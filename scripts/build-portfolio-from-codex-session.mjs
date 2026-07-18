import fs from 'node:fs';

const [sessionPath, outputPath, targetSnapshotPath = ''] = process.argv.slice(2);
if (!sessionPath || !outputPath) {
  throw new Error('Usage: node build-portfolio-from-codex-session.mjs <session-jsonl> <output-json> [target-snapshot-json]');
}

const lines = fs.readFileSync(sessionPath, 'utf8').split(/\r?\n/);
const parseToolJson = (lineNumber) => {
  const record = JSON.parse(lines[lineNumber - 1]);
  const output = (record.payload?.output || []).map((item) => item.text || '').join('');
  const secondOutput = output.indexOf('Output:', output.indexOf('Output:') + 1);
  const jsonStart = output.indexOf('[', secondOutput);
  return JSON.parse(output.slice(jsonStart));
};

const assetEvidence = parseToolJson(221)[0];
const ledgerEvidence = parseToolJson(213)[0];
const domesticTicker = /^\d{5,6}(?:\.(?:KS|KQ))?$/i;
const recoveredAt = '2026-07-17T04:14:19.205Z';

const assets = assetEvidence.rows.map((row) => {
  const ticker = String(row.ticker || '').trim().toUpperCase();
  const currency = domesticTicker.test(ticker) ? 'KRW' : 'USD';
  const id = `recovered-asset-${ticker || row.name}`;
  return {
    id,
    name: row.name,
    ticker,
    category: currency === 'KRW' ? '국내주식' : '해외주식',
    currency,
    originalCurrency: currency,
    quantity: Number(row.quantity) || 0,
    averagePrice: Number(row.price) || 0,
    originalAveragePrice: Number(row.price) || 0,
    currentPrice: Number(row.price) || 0,
    originalCurrentPrice: Number(row.price) || 0,
    buyDate: row.date || '',
    accountName: '',
    accountType: 'GENERAL',
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : recoveredAt,
    updatedAt: assetEvidence.latestUpdatedAt || recoveredAt,
    color: currency === 'KRW' ? '#e05555' : '#4169e1',
    recoverySource: 'codex-session-local-storage-summary',
  };
});

const assetsByTicker = new Map(assets.map((asset) => [asset.ticker, asset]));
const tradeLedger = ledgerEvidence.rows.map((row, index) => {
  const ticker = String(row.ticker || '').trim().toUpperCase();
  const currency = domesticTicker.test(ticker) ? 'KRW' : 'USD';
  const asset = assetsByTicker.get(ticker);
  return {
    id: `recovered-ledger-${String(index + 1).padStart(3, '0')}`,
    assetId: asset?.id || `recovered-closed-${ticker || row.name}`,
    name: row.name,
    ticker,
    side: row.side === 'sell' ? 'sell' : 'buy',
    quantity: Number(row.quantity) || 0,
    price: Number(row.price) || 0,
    date: row.date || '',
    currency,
    exchangeRate: 0,
    fee: 0,
    tax: 0,
    createdAt: row.date ? `${row.date}T00:00:00.000Z` : recoveredAt,
    updatedAt: ledgerEvidence.latestUpdatedAt || recoveredAt,
    recoverySource: 'codex-session-local-storage-summary',
  };
});

const memos = tradeLedger.map((row) => ({
  id: `recovered-memo-${row.id}`,
  assetId: row.assetId,
  name: row.name,
  ticker: row.ticker,
  action: row.side === 'sell' ? '매도' : '매수',
  side: row.side,
  quantity: row.quantity,
  price: row.price,
  date: row.date,
  currency: row.currency,
  memo: '로컬 원장 기록에서 복구',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
}));

let preserved = {};
if (targetSnapshotPath && fs.existsSync(targetSnapshotPath)) {
  preserved = JSON.parse(fs.readFileSync(targetSnapshotPath, 'utf8'))?.data || {};
}

const backup = {
  kind: 'my-portfolio-backup',
  version: 1,
  exportedAt: new Date().toISOString(),
  recoverySource: 'codex-session-2026-07-18-chrome-leveldb-025699',
  evidence: {
    assetCount: assetEvidence.rowCount,
    assetLatestUpdatedAt: assetEvidence.latestUpdatedAt,
    ledgerCount: ledgerEvidence.rowCount,
    ledgerLatestUpdatedAt: ledgerEvidence.latestUpdatedAt,
  },
  data: {
    portfolioName: preserved.portfolioName || '투자 통합 대시보드',
    assets,
    trades: [],
    memos,
    tradeLedger,
    autoDividends: [],
    confirmedDividends: [],
    dividendAssetRegistry: [],
    targetPortfolio: preserved.targetPortfolio || {},
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  outputPath,
  assets: assets.length,
  tradeLedger: tradeLedger.length,
  memos: memos.length,
  assetLatestUpdatedAt: assetEvidence.latestUpdatedAt,
  ledgerLatestUpdatedAt: ledgerEvidence.latestUpdatedAt,
}));
