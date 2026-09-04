import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDividendCalendarForecastQuantity,
  summarizeDividendCalendarEvents,
} from '../src/utils/dividendCalendar.js';

test('과거 보유 UNH의 배당 기록 수량으로 미래 배당을 다시 만들지 않는다', () => {
  const historicalUnh = {
    name: 'UNH',
    ticker: 'UNH',
    isCurrentHolding: false,
    history: [{ quantity: 8, amount: 15.78 }],
  };

  assert.equal(getDividendCalendarForecastQuantity(historicalUnh, null), 0);
});

test('미래 배당은 현재 자산에 실제 보유 수량이 있을 때만 계산한다', () => {
  const currentHolding = { name: 'SPDR S&P 500', isCurrentHolding: true };

  assert.equal(getDividendCalendarForecastQuantity(currentHolding, { quantity: 4 }), 4);
  assert.equal(getDividendCalendarForecastQuantity(currentHolding, { quantity: 0 }), 0);
  assert.equal(getDividendCalendarForecastQuantity(currentHolding, null), 0);
});

test('summarizes calendar dividends by currency without converting or mixing them', () => {
  const summary = summarizeDividendCalendarEvents([
    { currency: 'USD', netAmount: 12.5, isEstimated: false },
    { currency: 'KRW', netAmount: 1020, isEstimated: false },
    { currency: 'USD', netAmount: 7.25, isEstimated: true },
  ]);

  assert.deepEqual(summary, {
    eventCount: 3,
    confirmedCount: 2,
    estimatedCount: 1,
    totals: [
      { currency: 'KRW', amount: 1020 },
      { currency: 'USD', amount: 19.75 },
    ],
  });
});

test('ignores invalid amounts and keeps valid zero amounts in the event count', () => {
  const summary = summarizeDividendCalendarEvents([
    { currency: 'USD', netAmount: 'invalid', isEstimated: true },
    { currency: 'JPY', netAmount: 0, isEstimated: true },
  ]);

  assert.deepEqual(summary, {
    eventCount: 1,
    confirmedCount: 0,
    estimatedCount: 1,
    totals: [{ currency: 'JPY', amount: 0 }],
  });
});
