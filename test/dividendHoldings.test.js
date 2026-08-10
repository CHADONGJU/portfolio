import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDividendCalculationAssets,
  getDividendHeldQuantityOnDate,
  getDividendLedgerRows,
} from '../src/utils/dividendHoldings.js';

const buy = (id, assetId, ticker, date, quantity, price) => ({
  id, assetId, ticker, name: ticker, side: 'buy', date, quantity, price,
});

test('does not add an unlinked snapshot row to its recovered lots again', () => {
  const asset = { id: 1, ticker: 'VZ', name: 'VZ', quantity: 100 };
  const ledger = [
    buy('lot-1', 'recovered-VZ', 'VZ', '2025-07-02', 30, 42.59),
    buy('lot-2', 'recovered-VZ', 'VZ', '2025-10-28', 20, 38.739),
    buy('snapshot', null, 'VZ', '2026-05-19', 50, 41.15),
  ];

  assert.equal(getDividendLedgerRows(asset, ledger).length, 2);
  assert.equal(getDividendHeldQuantityOnDate(asset, ledger, '2026-07-10'), 50);
});

test('uses all real lots for the same ticker after removing the duplicate snapshot', () => {
  const asset = { id: 2, ticker: '453810', name: '인도 Nifty50', quantity: 48 };
  const ledger = [
    buy('initial', 'recovered-453810', '453810', '2026-05-18', 48, 12340),
    buy('snapshot', null, '453810', '2026-05-24', 48, 12340),
    buy('add-1', 'recovered-453810', '453810', '2026-06-08', 16, 12565),
    buy('add-2', 'recovered-453810', '453810', '2026-06-10', 32, 12550),
    buy('add-3', 'recovered-453810', '453810', '2026-07-14', 24, 12885),
  ];

  assert.equal(getDividendHeldQuantityOnDate(asset, ledger, '2026-07-31'), 120);
});

test('a position sold before the ex-date has zero dividend entitlement', () => {
  const asset = { id: 3, ticker: 'GEV', name: 'GEV', quantity: 1 };
  const ledger = [
    buy('snapshot', null, 'GEV', '2026-05-19', 1, 863.15),
    buy('recovered-buy', 'recovered-closed-GEV', 'GEV', '2026-06-03', 1, 863.15),
    { id: 'sell', assetId: 'recovered-closed-GEV', ticker: 'GEV', name: 'GEV', side: 'sell', date: '2026-06-09', quantity: 1, price: 883.7861 },
  ];

  assert.equal(getDividendLedgerRows(asset, ledger).length, 2);
  assert.equal(getDividendHeldQuantityOnDate(asset, ledger, '2026-06-16'), 0);
});

test('keeps a sold position as a dividend calculation asset', () => {
  const activeAssets = [{ id: 1, ticker: 'VZ', name: 'VZ', currency: 'USD' }];
  const ledger = [
    buy('qcom-buy', 'closed-QCOM', 'QCOM', '2026-01-10', 2, 150),
    { id: 'qcom-sell', assetId: 'closed-QCOM', ticker: 'QCOM', name: 'QCOM', side: 'sell', date: '2026-07-09', quantity: 2, price: 160, currency: 'USD' },
  ];

  const calculationAssets = buildDividendCalculationAssets(activeAssets, ledger);
  const qcom = calculationAssets.find((asset) => asset.ticker === 'QCOM');

  assert.equal(calculationAssets.length, 2);
  assert.equal(qcom.buyDate, '2026-01-10');
  assert.equal(qcom.quantity, 0);
  assert.equal(qcom.historicalOnly, true);
});

test('QCOM은 매도일이 아니라 배당 기준일 당시의 4주를 사용한다', () => {
  const ledger = [
    buy('qcom-buy-1', 'closed-QCOM', 'QCOM', '2026-05-19', 2, 150),
    buy('qcom-buy-2', 'closed-QCOM', 'QCOM', '2026-06-03', 2, 154),
    { id: 'qcom-sell', assetId: 'closed-QCOM', ticker: 'QCOM', name: 'QCOM', side: 'sell', date: '2026-07-09', quantity: 2, price: 160 },
  ];
  const [qcom] = buildDividendCalculationAssets([], ledger);

  assert.equal(getDividendHeldQuantityOnDate(qcom, ledger, '2026-06-04'), 4);
});

test('does not duplicate an active asset that is also present in the ledger', () => {
  const activeAssets = [{ id: 1, ticker: 'VZ', name: 'VZ', currency: 'USD' }];
  const ledger = [buy('vz-buy', 'asset-VZ', 'vz', '2025-07-02', 30, 42.59)];

  const calculationAssets = buildDividendCalculationAssets(activeAssets, ledger);

  assert.equal(calculationAssets.length, 1);
  assert.equal(calculationAssets[0], activeAssets[0]);
});
