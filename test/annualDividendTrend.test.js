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
    assets: [{ name: 'JEPI', quantity: 100, currency: 'USD' }],
    dividendSummary: [{
      name: 'JEPI',
      ticker: 'JEPI',
      currency: 'USD',
      isCurrentHolding: true,
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

test('projects September and October payments from one shared stream with calendar amounts', () => {
  const events = buildAnnualDividendEvents({
    year: 2026,
    today: new Date('2026-09-08T00:00:00Z'),
    assets: [{ name: '월배당', quantity: 20, currency: 'USD' }],
    dividendSummary: [{
      name: '월배당', currency: 'USD', isCurrentHolding: true, expectedAmount: 18,
      history: [
        { exDate: '2026-08-10', paymentDate: '2026-08-14', currency: 'USD', amount: 8, quantity: 10, perShareGrossAmount: 1 },
        { exDate: '2026-07-10', paymentDate: '2026-07-14', currency: 'USD', amount: 8, quantity: 10 },
      ],
    }],
  });

  const estimates = events.filter((event) => event.isEstimated);
  assert.deepEqual(estimates.map((event) => event.date), [
    '2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15',
  ]);
  const october = estimates.find((event) => event.date.startsWith('2026-10'));
  assert.equal(october.exDate, '2026-10-10');
  assert.equal(october.eligibilityDate, '2026-10-12');
  assert.equal(october.dateLabel, '예상 지급일');
  assert.equal(october.officialPaymentDate, '');
  assert.equal(october.amount, 18);
  assert.equal(october.netAmount, 18);
  assert.equal(october.grossAmount, 20);
  assert.equal(october.quantity, 20);
});

test('assigns September ex-date forecasts to their October payment month', () => {
  const events = buildAnnualDividendEvents({
    year: 2026,
    today: new Date('2026-09-08T00:00:00Z'),
    assets: [{ name: '늦은 지급', quantity: 10 }],
    dividendSummary: [{
      name: '늦은 지급', currency: 'USD', isCurrentHolding: true, expectedAmount: 10,
      history: [
        { exDate: '2026-08-20', paymentDate: '2026-09-04', amount: 10 },
        { exDate: '2026-07-20', paymentDate: '2026-08-04', amount: 10 },
      ],
    }],
  });
  const october = events.find((event) => event.isEstimated && event.date.startsWith('2026-10'));
  assert.equal(october.date, '2026-10-06');
  assert.equal(october.exDate, '2026-09-20');
  const trend = summarizeAnnualDividendTrend({ events, resolveKrwRate: () => 1400 });
  assert.equal(trend.months[9].total, october.netAmount * 1400);
  assert.deepEqual(trend.months[9].events.map((event) => event.id), [october.id]);
});

test('keeps USD September 30 official payments in October and honors actual payment dates', () => {
  const events = buildAnnualDividendEvents({
    year: 2026,
    today: new Date('2026-09-08T00:00:00Z'),
    dividendSummary: [{
      name: '월말 지급', currency: 'USD', isCurrentHolding: false,
      history: [
        { id: 'official', exDate: '2026-09-10', paymentDate: '2026-09-30', amount: 10, quantity: 2 },
        { id: 'actual', exDate: '2026-09-11', paymentDate: '2026-09-30', actualPaymentDate: '2026-10-02', amount: 20 },
        { id: 'legacy', exDate: '2026-10-03', amount: 5 },
      ],
    }],
  });
  assert.deepEqual(events.map((event) => event.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(events.map((event) => event.dateLabel), ['한국시간 지급일', '지급일', '배당 기록일']);
  assert.deepEqual(events.map((event) => event.netAmount), [10, 20, 5]);
  assert.equal(events[0].officialPaymentDate, '2026-09-30');
  assert.equal(events[0].fxDate, '2026-09-30');
  assert.equal(events[1].officialPaymentDate, '2026-10-02');
  assert.equal(events[2].quantity, 0);
});

test('requires both a current holding flag and positive actual quantity for forecasts', () => {
  for (const [isCurrentHolding, assets] of [
    [true, []],
    [true, [{ name: '종목', quantity: 0 }]],
    [false, [{ name: '종목', quantity: 10 }]],
    [undefined, [{ name: '종목', quantity: 10 }]],
  ]) {
    const events = buildAnnualDividendEvents({
      year: 2026, today: new Date('2026-09-08T00:00:00Z'), assets,
      dividendSummary: [{
        name: '종목', currency: 'KRW', isCurrentHolding, expectedAmount: 100,
        history: [{ exDate: '2026-08-01', paymentDate: '2026-08-05', amount: 100, quantity: 10 }],
      }],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].isEstimated, false);
  }
});

test('deduplicates ex-dates for interval estimation and preserves the original month-end day', () => {
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-02-01T00:00:00Z'),
    assets: [{ name: '말일', quantity: 1 }],
    dividendSummary: [{
      name: '말일', currency: 'KRW', isCurrentHolding: true, expectedAmount: 100,
      history: [
        { id: 'jan-a', exDate: '2026-01-31', paymentDate: '2026-01-31', amount: 50 },
        { id: 'jan-b', exDate: '2026-01-31', paymentDate: '2026-01-31', amount: 50 },
        { id: 'dec', exDate: '2025-12-31', paymentDate: '2025-12-31', amount: 100 },
      ],
    }],
  });
  const estimates = events.filter((event) => event.isEstimated);
  assert.deepEqual(estimates.slice(0, 3).map((event) => event.exDate), [
    '2026-02-28', '2026-03-31', '2026-04-30',
  ]);
  assert.equal(events.filter((event) => !event.isEstimated).length, 2);
});

test('retains upcoming estimated payments when their ex-date has already passed', () => {
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-08T00:00:00Z'),
    assets: [{ name: '지급 대기', quantity: 1 }],
    dividendSummary: [{
      name: '지급 대기', currency: 'KRW', isCurrentHolding: true, expectedAmount: 100,
      history: [
        { exDate: '2026-08-01', paymentDate: '2026-08-20', amount: 100 },
        { exDate: '2026-07-01', paymentDate: '2026-07-20', amount: 100 },
      ],
    }],
  });
  const september = events.find((event) => event.isEstimated && event.date.startsWith('2026-09'));
  assert.equal(september.exDate, '2026-09-01');
  assert.equal(september.date, '2026-09-20');
});

test('uses the Korean day when excluding past forecasts around midnight', () => {
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-30T15:30:00Z'),
    assets: [{ name: '한국 날짜', quantity: 1 }],
    dividendSummary: [{
      name: '한국 날짜', currency: 'KRW', isCurrentHolding: true, expectedAmount: 100,
      history: [
        { exDate: '2026-08-30', paymentDate: '2026-08-30', amount: 100 },
        { exDate: '2026-07-30', paymentDate: '2026-07-30', amount: 100 },
      ],
    }],
  });
  assert.equal(events.find((event) => event.isEstimated).date, '2026-10-30');
});

test('includes an announced October payment once and forecasts after its declared ex-date', () => {
  const received = { id: 'received', exDate: '2026-08-20', paymentDate: '2026-09-04', currency: 'USD', amount: 10 };
  const announced = { id: 'announced', exDate: '2026-09-20', paymentDate: '2026-10-01', currency: 'USD', amount: 15, quantity: 10 };
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-08T00:00:00Z'),
    assets: [{ name: '공시 종목', quantity: 10 }],
    dividendSummary: [{
      name: '공시 종목', currency: 'USD', isCurrentHolding: true, expectedAmount: 15,
      history: [received],
      scheduleHistory: [announced, received],
    }],
  });
  const october = events.filter((event) => event.date.startsWith('2026-10'));
  assert.equal(october.length, 1);
  assert.equal(october[0].date, '2026-10-02');
  assert.equal(october[0].netAmount, 15);
  assert.equal(october[0].isEstimated, false);
  const nextEstimate = events.find((event) => event.isEstimated);
  assert.equal(nextEstimate.exDate, '2026-10-20');
  assert.equal(nextEstimate.date, '2026-11-01');
  assert.equal(events.filter((event) => event.id.startsWith('received-')).length, 1);
});

test('keeps receipt history authoritative when adding declared future schedules', () => {
  const received = { id: 'manual', exDate: '2026-09-01', actualPaymentDate: '2026-10-02', currency: 'USD', amount: 25 };
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-08T00:00:00Z'),
    dividendSummary: [{
      name: '수령 종목', currency: 'USD', isCurrentHolding: false,
      history: [received],
      scheduleHistory: [
        { ...received, amount: 20 },
        { id: 'unverified', exDate: '2026-08-01', paymentDate: '2026-08-05', amount: 100 },
      ],
    }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, 25);
});

test('preserves same-date legacy receipts across accounts and gives each calendar entry a unique id', () => {
  const history = [
    { date: '2026-10-01', amount: 10, quantity: 2, accountType: '일반' },
    { date: '2026-10-01', amount: 10, quantity: 2, accountType: 'ISA' },
  ];
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-08T00:00:00Z'),
    dividendSummary: [{ name: '같은 종목', currency: 'KRW', isCurrentHolding: false, history }],
  });

  assert.equal(events.length, 2);
  assert.equal(events.reduce((sum, event) => sum + event.amount, 0), 20);
  assert.equal(new Set(events.map((event) => event.id)).size, 2);
  assert.equal(history.length, 2);
});

test('appends a no-id future schedule for a separate account without repeating an existing receipt', () => {
  const received = { date: '2026-09-20', paymentDate: '2026-10-01', currency: 'KRW', amount: 10, quantity: 2, accountType: '일반' };
  const events = buildAnnualDividendEvents({
    year: 2026, today: new Date('2026-09-08T00:00:00Z'),
    dividendSummary: [{
      name: '같은 종목', currency: 'KRW', isCurrentHolding: false,
      history: [received],
      scheduleHistory: [received, { ...received, accountType: 'ISA' }],
    }],
  });

  assert.equal(events.length, 2);
  assert.equal(events.reduce((sum, event) => sum + event.amount, 0), 20);
  assert.equal(new Set(events.map((event) => event.id)).size, 2);
});
