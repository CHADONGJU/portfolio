import fs from 'node:fs';
import path from 'node:path';

const [backupPath, receiptsPath, outputPath] = process.argv.slice(2);
if (!backupPath || !receiptsPath || !outputPath) {
  throw new Error('Usage: node scripts/merge-confirmed-dividends-into-backup.mjs <backup.json> <receipts.json> <output.json>');
}

const backup = JSON.parse(fs.readFileSync(path.resolve(backupPath), 'utf8'));
const receipts = JSON.parse(fs.readFileSync(path.resolve(receiptsPath), 'utf8'));
const confirmedDividends = Array.isArray(receipts)
  ? receipts
  : receipts.confirmedDividends;

if (backup?.kind !== 'my-portfolio-backup' || backup?.version !== 1 || !backup?.data) {
  throw new Error('Invalid portfolio backup');
}
if (!Array.isArray(confirmedDividends)) {
  throw new Error('Confirmed dividend receipt file must be an array');
}

const identities = new Set();
confirmedDividends.forEach((record) => {
  if (!record.id || !record.name || !record.currency || !Number.isFinite(Number(record.amount))) {
    throw new Error(`Invalid confirmed dividend record: ${JSON.stringify(record)}`);
  }
  if (identities.has(record.id)) throw new Error(`Duplicate confirmed dividend id: ${record.id}`);
  identities.add(record.id);
});

const merged = {
  ...backup,
  exportedAt: new Date().toISOString(),
  recoverySource: `${backup.recoverySource || 'portfolio-backup'}+confirmed-dividend-receipts`,
  data: {
    ...backup.data,
    confirmedDividends,
  },
};

fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  outputPath: path.resolve(outputPath),
  assets: merged.data.assets?.length || 0,
  tradeLedger: merged.data.tradeLedger?.length || 0,
  confirmedDividends: confirmedDividends.length,
  totals: confirmedDividends.reduce((summary, record) => {
    const currency = String(record.currency).toUpperCase();
    summary[currency] = Number(((summary[currency] || 0) + Number(record.amount)).toFixed(8));
    return summary;
  }, {}),
}, null, 2));
