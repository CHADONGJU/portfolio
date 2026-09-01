import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchHistoricalCloseQuotes,
  isMarketCloseFinalized,
  readYahooHistoricalClose,
} from '../src/historicalMarketData.js';

const yahooChart = ({ timestamps, closes, timeZone = 'America/New_York' }) => ({
  chart: {
    result: [{
      meta: { currency: 'USD', exchangeTimezoneName: timeZone },
      timestamp: timestamps,
      indicators: { quote: [{ close: closes }] },
    }],
  },
});

test('미국 정규장 진행 중인 거래일 일봉은 exact date여도 pending이다', () => {
  const data = yahooChart({
    timestamps: [Math.floor(new Date('2026-08-28T13:30:00Z').getTime() / 1000)],
    closes: [200],
  });
  const quote = readYahooHistoricalClose(data, '2026-08-28', {
    now: new Date('2026-08-28T16:27:00Z'),
  });

  assert.equal(quote.priceDate, '2026-08-28');
  assert.equal(quote.marketDayStatus, 'trading-day');
  assert.equal(quote.priceStatus, 'pending-close');
});

test('미국 정규장 종료 후 target date 일봉만 confirmed-close가 된다', () => {
  const data = yahooChart({
    timestamps: [Math.floor(new Date('2026-08-28T13:30:00Z').getTime() / 1000)],
    closes: [201],
  });
  const quote = readYahooHistoricalClose(data, '2026-08-28', {
    now: new Date('2026-08-28T22:10:00Z'),
  });

  assert.equal(isMarketCloseFinalized({
    targetDate: '2026-08-28',
    timeZone: 'America/New_York',
    now: new Date('2026-08-28T22:10:00Z'),
  }), true);
  assert.equal(quote.price, 201);
  assert.equal(quote.priceStatus, 'confirmed-close');
});

test('주말은 가장 최근 confirmed close fallback과 실제 priceDate를 보존한다', () => {
  const data = yahooChart({
    timestamps: [Math.floor(new Date('2026-08-28T13:30:00Z').getTime() / 1000)],
    closes: [201],
  });
  const quote = readYahooHistoricalClose(data, '2026-08-29', {
    now: new Date('2026-08-30T22:10:00Z'),
  });

  assert.equal(quote.marketDayStatus, 'closed');
  assert.equal(quote.priceDate, '2026-08-28');
  assert.equal(quote.priceStatus, 'confirmed-close-fallback');
});

test('평일인데 target date 종가가 없으면 이전 종가로 COMPLETE 처리하지 않는다', () => {
  const data = yahooChart({
    timestamps: [Math.floor(new Date('2026-08-27T13:30:00Z').getTime() / 1000)],
    closes: [199],
  });
  const quote = readYahooHistoricalClose(data, '2026-08-28', {
    now: new Date('2026-08-28T22:10:00Z'),
  });

  assert.equal(quote.priceDate, '2026-08-27');
  assert.equal(quote.marketDayStatus, 'unknown');
  assert.equal(quote.priceStatus, 'pending-close');
});

test('동일한 종목은 사용자가 달라도 종가 API를 한 번만 호출한다', async () => {
  let calls = 0;
  const quotes = await fetchHistoricalCloseQuotes([
    { ticker: 'AAPL', market: '미국', category: '미국주식' },
    { ticker: 'AAPL', market: '미국', category: '미국주식' },
  ], '2026-08-31', {
    now: new Date('2026-09-01T02:10:00Z'),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(yahooChart({
        timestamps: [Math.floor(new Date('2026-08-31T13:30:00Z').getTime() / 1000)],
        closes: [203],
      })), { status: 200 });
    },
  });

  assert.equal(calls, 1);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].price, 203);
  assert.equal(quotes[1].price, 203);
});

test('subrequest 예산이 다하면 외부 호출 없이 누락 시세로 남긴다', async () => {
  let calls = 0;
  const requestBudget = { remaining: 0 };
  const quotes = await fetchHistoricalCloseQuotes([
    { ticker: 'AAPL', market: '미국', category: '미국주식' },
  ], '2026-08-31', {
    requestBudget,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(quotes, [null]);
  assert.equal(requestBudget.remaining, 0);
});
