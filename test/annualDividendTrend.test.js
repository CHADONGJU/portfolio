import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnnualDividendEvents,
  summarizeAnnualDividendTrend,
} from '../src/utils/annualDividendTrend.js';

test('groups confirmed dividends into their Korean reporting months', () => {
  const events = buildAnnualDividendEvents({
    year: 2026,
    today: new Date('2026-08-14T00:00:00Z'),
    dividendSummary: [{
      name: 'SPDR S&P 500',
      ticker: 'SPY',
      currency: 'USD',
      expectedAmount: 0,
      history: [{
        id: 'spy-july',
        date: '2026-06-18',
        exDate: '2026-06-18',
        paymentDate: '2026-07-31',
        currency: 'USD',
        amount: 1.62,
      }],
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].date, '2026-08-01');
  assert.equal(events[0].fxDate, '2026-07-31');
  assert.equal(events[0].isEstimated, false);
});

test('projects recurring monthly dividends through the selected year', () => {
  const events = buildAnnualDividendEvents({
    year: 2026,
    today: new Date('2026-08-14T00:00:00Z'),
    dividendSummary: [{
      name: 'JEPI',
      ticker: 'JEPI',
      currency: 'USD',
      expectedAmount: 45,
      history: [
        { id: 'aug', date: '2026-08-01', exDate: '2026-08-01', paymentDate: '2026-08-05', currency: 'USD', amount: 42 },
        { id: 'jul', date: '2026-07-01', exDate: '2026-07-01', paymentDate: '2026-07-06', currency: 'USD', amount: 43 },
      ],
    }],
  });

  const estimates = events.filter((event) => event.isEstimated);
  assert.deepEqual(estimates.map((event) => event.date.slice(0, 7)), [
    '2026-09',
    '2026-10',
    '2026-11',
    '2026-12',
  ]);
  assert.ok(estimates.every((event) => event.amount === 45));
});

test('builds 12 stacked months with top five assets and an other segment', () => {
  const events = Array.from({ length: 6 }, (_, index) => ({
    id: `event-${index}`,
    name: `종목 ${index + 1}`,
    ticker: `T${index + 1}`,
    date: '2026-08-01',
    currency: 'USD',
    amount: 10 - index,
    isEstimated: index === 0,
  }));
  const trend = summarizeAnnualDividendTrend({
    events,
    resolveKrwRate: () => 1000,
  });

  assert.equal(trend.months.length, 12);
  assert.equal(trend.months[7].total, 45000);
  assert.equal(trend.months[7].estimatedTotal, 10000);
  assert.equal(trend.topAssets.length, 5);
  assert.equal(trend.hasOther, true);
  assert.ok(trend.months[7].segments.some((segment) => segment.name === '기타'));
  assert.equal(trend.monthlyAverage, 3750);
});

test('keeps a sold holding received history but does not project future dividends', () => {
  const events = buildAnnualDividendEvents({
    year: 2026,
    today: new Date('2026-08-20T00:00:00Z'),
    dividendSummary: [{
      name: 'UNH',
      ticker: 'UNH',
      currency: 'USD',
      isCurrentHolding: false,
      expectedAmount: 30,
      history: [{
        id: 'unh-june',
        exDate: '2026-06-15',
        paymentDate: '2026-06-23',
        currency: 'USD',
        amount: 30.8,
      }],
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].isEstimated, false);
  assert.equal(events[0].date, '2026-06-24');
});
