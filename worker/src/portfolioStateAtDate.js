import {
  buildPositionFromTradeRows,
  getTradeAssetKey,
  getTradeRecordDate,
  parseTradeNumber,
} from '../../src/utils/tradeReconciliation.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const toDateKey = (value) => String(value || '').slice(0, 10);
const isCashAsset = (asset) => String(asset?.category || '').trim() === '현금';

const getFlowDate = (flow) => toDateKey(flow?.date || flow?.transactionDate);

/**
 * Snapshot D의 시장자산 수량은 tradeLedger를 D까지 replay해서 만든다.
 * 현금은 별도 cash ledger가 없으므로 Cron 시점의 사용자가 확정한 현금 자산 잔액을
 * 사용하되, D 이후 등록 이벤트가 하나라도 있으면 그 잔액을 D 시점으로 간주하지 않는다.
 */
export const reconstructPortfolioAssetsAtDate = ({
  assets = [],
  tradeLedger = [],
  capitalFlows = [],
  targetDate = '',
} = {}) => {
  const issues = [];
  const ledgerByAsset = new Map();
  const invalidLedgerRows = [];

  tradeLedger.forEach((row) => {
    const date = toDateKey(getTradeRecordDate(row));
    if (!DATE_PATTERN.test(date)) {
      invalidLedgerRows.push(row);
      return;
    }
    const key = getTradeAssetKey(row);
    if (!ledgerByAsset.has(key)) ledgerByAsset.set(key, []);
    ledgerByAsset.get(key).push(row);
  });
  if (invalidLedgerRows.length > 0) {
    issues.push({ reason: 'trade-ledger-date-missing', count: invalidLedgerRows.length });
  }

  const currentAssetsByKey = new Map(
    assets.filter((asset) => !isCashAsset(asset)).map((asset) => [getTradeAssetKey(asset), asset]),
  );
  const reconstructed = [];
  const replayedKeys = new Set();

  ledgerByAsset.forEach((rows, key) => {
    const eligibleRows = rows.filter((row) => toDateKey(getTradeRecordDate(row)) <= targetDate);
    const position = buildPositionFromTradeRows(eligibleRows);
    replayedKeys.add(key);
    if (eligibleRows.length > 0 && !position.hasBuyRows) {
      const current = currentAssetsByKey.get(key);
      if (current && parseTradeNumber(current.quantity) > 0) {
        reconstructed.push({
          ...current,
          stateSource: 'current-asset-unverified',
          stateAsOfDate: targetDate,
        });
      }
      issues.push({ reason: 'trade-ledger-replay-invalid', assetKey: key });
      return;
    }
    if (!(position.quantity > 0)) return;

    const template = currentAssetsByKey.get(key) || eligibleRows.at(-1) || rows.at(0) || {};
    reconstructed.push({
      ...template,
      quantity: Number(position.quantity.toFixed(8)),
      originalAveragePrice: position.averagePrice,
      averagePrice: position.averagePrice,
      stateSource: 'trade-ledger-replay',
      stateAsOfDate: targetDate,
    });

    const current = currentAssetsByKey.get(key);
    const hasFutureTrade = rows.some((row) => toDateKey(getTradeRecordDate(row)) > targetDate);
    if (!hasFutureTrade && current
      && Math.abs(parseTradeNumber(current.quantity) - position.quantity) > 0.000001) {
      issues.push({
        reason: 'portfolio-position-ledger-mismatch',
        assetKey: key,
        ledgerQuantity: position.quantity,
        currentQuantity: parseTradeNumber(current.quantity),
      });
    }
  });

  currentAssetsByKey.forEach((asset, key) => {
    if (replayedKeys.has(key) || !(parseTradeNumber(asset.quantity) > 0)) return;
    reconstructed.push({ ...asset, stateSource: 'current-asset-unverified', stateAsOfDate: targetDate });
    issues.push({ reason: 'trade-ledger-missing', assetKey: key });
  });

  const cashAssets = assets.filter(isCashAsset).map((asset) => ({
    ...asset,
    stateSource: 'current-cash-balance',
    stateAsOfDate: targetDate,
  }));
  const futureTradeCount = tradeLedger.filter(
    (row) => toDateKey(getTradeRecordDate(row)) > targetDate,
  ).length;
  const futureFlowCount = capitalFlows.filter((flow) => getFlowDate(flow) > targetDate).length;
  if (cashAssets.length > 0 && (futureTradeCount > 0 || futureFlowCount > 0)) {
    issues.push({
      reason: 'cash-state-after-target-ambiguous',
      futureTradeCount,
      futureFlowCount,
    });
  }

  return {
    assets: [...reconstructed, ...cashAssets],
    status: issues.length === 0 ? 'complete' : 'incomplete',
    issues,
    inputCounts: {
      currentAssets: assets.length,
      tradeLedger: tradeLedger.length,
      capitalFlows: capitalFlows.length,
      reconstructedAssets: reconstructed.length + cashAssets.length,
    },
  };
};
