import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAnnualIncomeReturn } from '../src/utils/annualIncomeReturn.js';
import { buildCanonicalTradeRows } from '../src/utils/tradeReconciliation.js';

const today = '2026-09-08';
const trade = (overrides = {}) => ({
  name: 'Income Fund', ticker: 'FUND', currency: 'KRW', side: 'buy',
  date: '2025-01-01', quantity: 10, price: 100000, ...overrides,
});
const canonical = (rows) => buildCanonicalTradeRows({ tradeLedger: rows,
  resolveKrwRate: (row) => row.currency === 'KRW' ? 1 : Number(row.fxRate) || 0 });
const income = (amount, event = {}) => ({ totalKRW: amount, count: 1, events: [
  { name: 'Income Fund', ticker: 'FUND', date: '2026-07-01', amount, ...event },
], unconvertedCount: 0, approximate: false });
const calculate = (options = {}) => calculateAnnualIncomeReturn({ year: 2026, today, ...options });

test('both dividend modes use opening cost plus year purchases, with net realized losses retained', () => {
  const rows = canonical([trade(), trade({ id: 'sale', side: 'sell', date: '2026-03-01', quantity: 5, price: 80000 })]);
  const options = { rows, dividendIncome: income(50000) };
  const without = calculate(options);
  const withIncome = calculate({ ...options, includeDividends: true });
  assert.equal(without.investedCostKRW, 1000000);
  assert.equal(withIncome.investedCostKRW, without.investedCostKRW);
  assert.equal(without.profitKRW, -100000);
  assert.equal(without.returnPercent, -10);
  assert.equal(withIncome.returnPercent, -5);
  assert.equal(withIncome.dividendsKRW, 50000);
  assert.equal(without.includedDividendsKRW, 0);
});

test('dividend-only holdings have a valid income return without any sales', () => {
  const result = calculate({ rows: canonical([trade()]), dividendIncome: income(50000), includeDividends: true });
  assert.equal(result.status, 'ready');
  assert.equal(result.sellCount, 0);
  assert.equal(result.openingCostKRW, 1000000);
  assert.equal(result.returnPercent, 5);
});

test('a tiny unrelated sale cannot make all holdings dividends an enormous percentage', () => {
  const rows = canonical([
    trade({ price: 10000000 }),
    trade({ name: 'Other', ticker: 'OTHER', quantity: 1, price: 10000 }),
    trade({ name: 'Other', ticker: 'OTHER', quantity: 1, price: 10000, side: 'sell', date: '2026-02-01' }),
  ]);
  const result = calculate({ rows, dividendIncome: income(5000000), includeDividends: true });
  assert.equal(result.investedCostKRW, 100010000);
  assert.ok(result.returnPercent < 5 && result.returnPercent > 4.99);
});

test('prior-year sales remove acquisition cost and fees before the opening snapshot', () => {
  const rows = canonical([
    trade({ currency: 'USD', price: 100, fxRate: 1300, brokerFee: 10 }),
    trade({ currency: 'USD', price: 120, fxRate: 1500, side: 'sell', date: '2025-10-01', quantity: 4 }),
  ]);
  const result = calculate({ rows, dividendIncome: income(7878), includeDividends: true });
  assert.equal(result.openingCostKRW, 787800);
  assert.equal(result.periodBuyCostKRW, 0);
  assert.equal(result.returnPercent, 1);
  assert.equal(result.approximate, false);
});

test('year purchases include acquisition fees and reinvested purchases count again', () => {
  const rows = canonical([
    trade({ id: 'b1', date: '2026-01-01', quantity: 1, price: 10000, brokerFee: 100 }),
    trade({ id: 's1', date: '2026-02-01', side: 'sell', quantity: 1, price: 12000 }),
    trade({ id: 'b2', date: '2026-03-01', quantity: 1, price: 12000, round: 2 }),
  ]);
  const result = calculate({ rows });
  assert.equal(result.buyKRW, 22000);
  assert.equal(result.periodBuyCostKRW, 22100);
  assert.equal(result.profitKRW, 1900);
  assert.equal(result.returnPercent, 1900 / 22100 * 100);
});

test('unmatched sales and missing dividend acquisition history are unavailable', () => {
  const unmatched = calculate({ rows: canonical([trade({ side: 'sell', date: '2026-03-01' })]) });
  assert.equal(unmatched.returnPercent, null);
  assert.equal(unmatched.basisUnavailableReason, 'missing-trade-history');
  const earlyReceipt = calculate({ rows: canonical([trade({ date: '2026-08-01' })]), dividendIncome: income(10000) });
  assert.equal(earlyReceipt.returnPercent, null);
  assert.equal(earlyReceipt.basisUnavailableReason, 'missing-dividend-cost');
});

test('future trades are excluded using Korean calendar date and historical years end December 31', () => {
  const rows = canonical([
    trade({ date: '2026-09-08', quantity: 1, price: 10000 }),
    trade({ date: '2026-09-09', quantity: 1, price: 20000 }),
    trade({ date: '2027-01-01', quantity: 1, price: 30000 }),
  ]);
  const result = calculate({ rows, today: new Date('2026-09-07T16:00:00Z') });
  assert.equal(result.buyKRW, 10000);
  assert.equal(result.buyCount, 1);
  const historical = calculate({ rows, today: '2027-03-01' });
  assert.equal(historical.buyKRW, 30000);
});

test('unknown currencies and unconverted included dividends cannot yield a percentage', () => {
  const unknown = calculate({ rows: canonical([trade({ currency: 'ZZZ', date: '2026-01-01' })]) });
  assert.equal(unknown.returnPercent, null);
  assert.equal(unknown.basisUnavailableReason, 'missing-exchange-rate');
  const dividendIncome = { ...income(0), unconvertedCount: 1 };
  const options = { rows: canonical([trade()]), dividendIncome };
  assert.equal(calculate({ ...options, includeDividends: true }).basisUnavailableReason, 'missing-dividend-exchange-rate');
  assert.equal(calculate(options).returnPercent, 0);
});

test('current-rate fallbacks are explicitly approximate, and missing holding history is unavailable', () => {
  const result = calculate({ rows: canonical([trade({ currency: 'USD' })]), exchangeRate: 1400 });
  assert.equal(result.approximate, true);
  assert.equal(result.openingCostKRW, 1400000000);
  const absent = calculate({ rows: canonical([trade()]), assets: [trade({ name: 'Missing', ticker: 'MISSING', buyDate: '2025-05-01' })] });
  assert.equal(absent.basisUnavailableReason, 'missing-holding-cost');
  assert.equal(absent.returnPercent, null);
});

test('missing capital is unavailable instead of an invented zero-percent return', () => {
  const result = calculate();
  assert.equal(result.returnPercent, null);
  assert.equal(result.basisUnavailableReason, 'missing-capital-base');
});

test('foreign purchase cost stays at acquisition FX even if sale FX differs', () => {
  const rows = canonical([
    trade({ date: '2026-01-01', currency: 'USD', price: 100, fxRate: 1300 }),
    trade({ date: '2026-03-01', currency: 'USD', price: 110, fxRate: 1400, side: 'sell' }),
  ]);
  const result = calculate({ rows, exchangeRate: 9999 });
  assert.equal(result.investedCostKRW, 1300000);
  assert.equal(result.soldCostKRW, 1300000);
  assert.equal(result.profitKRW, 130000);
  assert.equal(result.returnPercent, 10);
});

test('future periods and incomplete acquisition prices cannot produce a return', () => {
  const future = calculate({ rows: canonical([trade()]), year: 2027 });
  assert.equal(future.basisUnavailableReason, 'future-period');
  assert.equal(future.returnPercent, null);
  const unknownPrice = calculate({ rows: [trade({ price: 0 })] });
  assert.equal(unknownPrice.basisUnavailableReason, 'missing-acquisition-cost');
  assert.equal(unknownPrice.returnPercent, null);
});

test('dividend exchange-rate approximation only affects the included mode', () => {
  const options = { rows: canonical([trade()]), dividendIncome: { ...income(10000), approximate: true } };
  assert.equal(calculate(options).approximate, false);
  assert.equal(calculate({ ...options, includeDividends: true }).approximate, true);
});

test('a closed old round cannot stand in for the acquisition cost of a current holding', () => {
  const rows = canonical([
    trade({ quantity: 1, price: 10000, round: 1 }),
    trade({ side: 'sell', date: '2025-03-01', quantity: 1, price: 10000, round: 1 }),
    trade({ name: 'Other', ticker: 'OTHER', date: '2026-01-01', quantity: 1, price: 10000 }),
  ]);
  const result = calculate({ rows, assets: [trade({ quantity: 10000, round: 2, buyDate: '2026-04-01' })],
    dividendIncome: income(5000000), includeDividends: true });
  assert.equal(result.basisUnavailableReason, 'missing-holding-cost');
  assert.equal(result.returnPercent, null);
});

test('current holdings with partly missing acquisition quantities are unavailable', () => {
  const result = calculate({ rows: canonical([trade({ quantity: 1 })]),
    assets: [trade({ quantity: 10, buyDate: '2025-01-01' })] });
  assert.equal(result.basisUnavailableReason, 'missing-holding-cost');
  assert.equal(result.returnPercent, null);
});

test('holdings without a round use the recorded remaining quantity across matching rounds', () => {
  const rows = canonical([
    trade({ quantity: 1, round: 1 }),
    trade({ side: 'sell', date: '2025-03-01', quantity: 1, round: 1 }),
    trade({ quantity: 10, date: '2026-01-01', round: 2 }),
  ]);
  const result = calculate({ rows, assets: [trade({ quantity: 10, buyDate: '2026-01-01' })] });
  assert.equal(result.status, 'ready');
  assert.equal(result.investedCostKRW, 1000000);
});

test('historical returns never compare a current holding quantity to past inventory', () => {
  const result = calculate({ year: 2025, rows: canonical([trade({ quantity: 1 })]),
    assets: [trade({ quantity: 10, round: 2, buyDate: '2025-01-01' })] });
  assert.equal(result.status, 'ready');
  assert.equal(result.investedCostKRW, 100000);
});
