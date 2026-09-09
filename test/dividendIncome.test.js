import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDividendIncomeRate, summarizeDividendIncome } from '../src/utils/dividendIncome.js';
import { selectReportedDividendRecords } from '../src/utils/dividendRecords.js';

const today = new Date('2026-09-08T03:00:00Z');
const receipt = (overrides = {}) => ({
  id: 'receipt', name: '배당 종목', ticker: 'DIV', currency: 'USD',
  amount: 100, paymentDate: '2026-08-20', entitlementVerified: true,
  ...overrides,
});

test('uses historical payment-day FX consistently instead of current FX for received income', () => {
  const result = summarizeDividendIncome({
    dividends: [receipt()], year: 2026, today,
    exchangeRate: 1400, historicalRates: { '2026-08-20': 1300, '2026-08-21': 1500 },
  });
  assert.equal(result.totalKRW, 130000);
  assert.equal(result.events[0].date, '2026-08-21');
  assert.equal(result.events[0].fxDate, '2026-08-20');
  assert.equal(result.approximate, false);
  assert.deepEqual(result.totals, [{ currency: 'USD', amount: 100 }]);
});

test('prefers recorded FX and always values KRW receipts at one won per won', () => {
  const rates = { exchangeRate: 1400, historicalRates: { '2026-08-20': 1300 } };
  assert.deepEqual(resolveDividendIncomeRate(receipt({ fxRate: 1250 }), rates), {
    rate: 1250, approximate: false, unconverted: false,
  });
  assert.deepEqual(resolveDividendIncomeRate(receipt({ currency: 'KRW', fxRate: 1400 }), rates), {
    rate: 1, approximate: false, unconverted: false,
  });
});

test('uses the same historical FX when resolving transformed annual chart events', () => {
  const result = resolveDividendIncomeRate({ currency: 'USD', date: '2026-08-21', fxDate: '2026-08-20' }, {
    exchangeRate: 1400, historicalRates: { '2026-08-20': 1300 },
  });
  assert.deepEqual(result, { rate: 1300, approximate: false, unconverted: false });
});

test('assigns USD year-end payments to the Korean reporting year and honors actual receipt dates', () => {
  const dividends = [
    receipt({ id: 'official', paymentDate: '2025-12-31', amount: 100 }),
    receipt({ id: 'actual', actualPaymentDate: '2025-12-31', paymentDate: '2025-12-31', amount: 50, status: 'actual' }),
  ];
  const options = { dividends, today, exchangeRate: 1400, historicalRates: { '2025-12-31': 1300 } };
  const currentYear = summarizeDividendIncome({ ...options, year: 2026 });
  const previousYear = summarizeDividendIncome({ ...options, year: 2025 });
  assert.deepEqual(currentYear.events.map((event) => event.id), ['official']);
  assert.deepEqual(previousYear.events.map((event) => event.id), ['actual']);
  assert.equal(currentYear.totalKRW, 130000);
  assert.equal(previousYear.totalKRW, 65000);
});

test('accepts received payments by the Korean day and excludes announced future payments', () => {
  const dividends = [
    receipt({ id: 'today', paymentDate: '2026-09-08' }),
    receipt({ id: 'future', paymentDate: '2026-10-01' }),
    receipt({ id: 'unverified', entitlementVerified: false }),
  ];
  const result = summarizeDividendIncome({
    dividends, year: 2026, today: new Date('2026-09-08T15:30:00Z'), exchangeRate: 1400,
  });
  assert.deepEqual(result.events.map((event) => event.id), ['today']);
  assert.equal(result.totalKRW, 140000);
  assert.equal(result.approximate, true);
});

test('future manual receipts do not enter income totals until their actual payment date', () => {
  const dividends = [receipt({
    id: 'manual-future', actualPaymentDate: '2026-10-02', status: 'actual', confirmationSource: 'user-entry',
  })];
  const options = { dividends, year: 2026, exchangeRate: 1400 };
  const pending = summarizeDividendIncome({ ...options, today });
  assert.equal(pending.totalKRW, 0);
  assert.equal(pending.count, 0);

  const paid = summarizeDividendIncome({ ...options, today: '2026-10-02' });
  assert.equal(paid.totalKRW, 140000);
  assert.equal(paid.manualCount, 1);
  assert.equal(dividends.length, 1);
  assert.equal(dividends[0].actualPaymentDate, '2026-10-02');
});

test('retains distinct same-day receipts across accounts without deduplication', () => {
  const dividends = [
    receipt({ id: 'isa', currency: 'KRW', accountType: 'ISA', amount: 1000 }),
    receipt({ id: 'general', currency: 'KRW', accountType: '일반', amount: 846 }),
    receipt({ id: 'second-payment', currency: 'KRW', accountType: '일반', amount: 500 }),
  ];
  const result = summarizeDividendIncome({ dividends, year: 2026, today });
  assert.equal(result.totalKRW, 2346);
  assert.equal(result.count, 3);
  assert.equal(result.automaticCount, 3);
  assert.equal(result.manualCount, 0);
  assert.equal(dividends[0].date, undefined);
});

test('aggregates manual replacement receipts already reconciled upstream only once', () => {
  const dividends = selectReportedDividendRecords([receipt()], [receipt({
    id: 'manual', amount: 90, actualPaymentDate: '2026-08-21',
    status: 'actual', confirmationSource: 'user-entry',
  })]);
  const result = summarizeDividendIncome({ dividends, year: 2026, today, exchangeRate: 1400 });
  assert.equal(result.totalKRW, 126000);
  assert.equal(result.count, 1);
  assert.equal(result.manualCount, 1);
  assert.equal(result.automaticCount, 0);
});

test('marks current-rate fallback approximate and preserves unsupported native currency income', () => {
  const result = summarizeDividendIncome({
    dividends: [
      receipt({ id: 'yen', currency: 'JPY', amount: 200 }),
      receipt({ id: 'hkd', currency: 'HKD', amount: 100 }),
    ],
    year: 2026, today, jpyKrwRate: 10,
    historicalRates: { '2026-08-20': 1300 },
  });
  assert.equal(result.totalKRW, 2000);
  assert.equal(result.unconvertedCount, 1);
  assert.equal(result.approximate, true);
  assert.deepEqual(result.totals, [{ currency: 'JPY', amount: 200 }, { currency: 'HKD', amount: 100 }]);
  assert.equal(result.events[1].krwAmount, 0);
  assert.equal(result.events[1].unconverted, true);
  assert.equal(resolveDividendIncomeRate({ currency: 'HKD' }, { currencyRates: { HKD: 175 } }).rate, 175);
});

test('ignores nonpositive, nonfinite, deleted, and undated income records', () => {
  const result = summarizeDividendIncome({
    dividends: [
      receipt({ amount: -1 }), receipt({ amount: 0 }), receipt({ amount: Infinity }),
      receipt({ amount: 'bad' }), receipt({ deletedAt: '2026-09-01' }),
      receipt({ paymentDate: undefined, status: 'actual', period: '2026-08' }),
    ], today,
  });
  assert.equal(result.count, 0);
  assert.equal(result.totalKRW, 0);
  assert.deepEqual(result.totals, []);
});

test('invalid stored and cached rates fall back to finite current conversion rates', () => {
  const result = resolveDividendIncomeRate(receipt({ fxRate: Infinity }), {
    exchangeRate: -1, currencyRates: { USD: 1400 }, historicalRates: { '2026-08-20': Infinity },
  });
  assert.deepEqual(result, { rate: 1400, approximate: true, unconverted: false });
});
