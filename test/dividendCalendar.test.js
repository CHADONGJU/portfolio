import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeDividendCalendarEvents } from '../src/utils/dividendCalendar.js';

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
