import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDividendCalendarForecastQuantity,
  selectDividendMonthEvents,
  summarizeDividendCalendarEvents,
} from '../src/utils/dividendCalendar.js';
import { buildAnnualDividendEvents, summarizeAnnualDividendTrend } from '../src/utils/annualDividendTrend.js';

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

test('October calendar and bars include the same payouts, currencies and forecasts beyond the next cycle', () => {
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-08T00:00:00Z'),
    assets: [{ name: 'Monthly', ticker: 'MONTH', currency: 'USD', quantity: 10 }],
    dividendSummary: [{
      name: 'Monthly', ticker: 'MONTH', currency: 'USD', isCurrentHolding: true, expectedAmount: 42,
      history: [
        { id: 'aug', exDate: '2026-08-10', paymentDate: '2026-08-15', currency: 'USD', quantity: 10, amount: 42 },
        { id: 'jul', exDate: '2026-07-10', paymentDate: '2026-07-15', currency: 'USD', quantity: 10, amount: 42 },
      ],
    }, {
      name: 'September payout', currency: 'USD', isCurrentHolding: false,
      history: [{ id: 'boundary', paymentDate: '2026-09-30', currency: 'USD', amount: 10 }],
    }, {
      name: 'Legacy receipt', currency: 'KRW', isCurrentHolding: false,
      history: [{ id: 'receipt', date: '2026-10-02', currency: 'KRW', amount: 2000 }],
    }],
  });
  const calendar = selectDividendMonthEvents(events, '2026-10');
  assert.deepEqual(calendar.map((event) => [event.name, event.date, event.netAmount]), [
    ['September payout', '2026-10-01', 10],
    ['Legacy receipt', '2026-10-02', 2000],
    ['Monthly', '2026-10-16', 42],
  ]);
  const trend = summarizeAnnualDividendTrend({ events, resolveKrwRate: (event) => event.currency === 'KRW' ? 1 : 1400 });
  assert.deepEqual(calendar.map((event) => event.id).sort(), trend.months[9].events.map((event) => event.id).sort());
  assert.equal(trend.months[9].total, 74800);
  assert.deepEqual(summarizeDividendCalendarEvents(calendar).totals, [
    { currency: 'KRW', amount: 2000 }, { currency: 'USD', amount: 52 },
  ]);
});
