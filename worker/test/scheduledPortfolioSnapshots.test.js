import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLatestScheduledSnapshotDate,
  getPreviousKstDate,
  runDailyPortfolioSnapshots,
} from '../src/scheduledPortfolioSnapshots.js';

const rootName = 'projects/demo/databases/(default)/documents/portfolioStates/user-1';

test('07:10 KST 실행은 전날을 snapshot 날짜로 사용한다', () => {
  assert.equal(getPreviousKstDate(new Date('2026-08-28T22:10:00.000Z')), '2026-08-28');
  assert.equal(getLatestScheduledSnapshotDate(new Date('2026-08-28T22:10:00.000Z')), '2026-08-28');
  assert.equal(getLatestScheduledSnapshotDate(new Date('2026-08-28T16:27:00.000Z')), '2026-08-27');
});

test('07:10 KST 이전에는 전날 Snapshot을 확정하지 않는다', async () => {
  let listed = false;
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    now: new Date('2026-08-28T16:27:00.000Z'),
    accessToken: 'token',
    listRoots: async () => {
      listed = true;
      return [];
    },
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.targetDate, '2026-08-28');
  assert.equal(result.latestEligibleDate, '2026-08-27');
  assert.equal(result.committed, 0);
  assert.equal(listed, false);
});

test('Snapshot은 collection-group 인덱스 없이 한 번 읽고 내부에서 날짜와 상태를 나눈다', async () => {
  let snapshotQuery = null;
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    targetDate: '2026-08-28',
    now: new Date('2026-08-28T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [],
    queryDocuments: async () => [],
    querySnapshotDocuments: async (query) => {
      snapshotQuery = query;
      return [];
    },
    commitSnapshots: async () => 0,
  });

  assert.equal(result.committed, 0);
  assert.equal(snapshotQuery.collectionId, 'portfolioSnapshots');
  assert.equal(snapshotQuery.whereFieldPath, undefined);
  assert.equal(snapshotQuery.whereValue, undefined);
});

test('전체 사용자 자산을 평가하고 snapshot-{date}를 멱등 저장한다', async () => {
  let committedSnapshots = [];
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    now: new Date('2026-08-28T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-20' } }],
    queryDocuments: async () => [
      {
        name: `${rootName}/assets/us-stock`,
        data: { id: 'us-stock', name: 'Apple', ticker: 'AAPL', category: '해외주식', currency: 'USD', quantity: 2 },
      },
      {
        name: `${rootName}/assets/usd-cash`,
        data: { id: 'usd-cash', category: '현금', currency: 'USD', quantity: 1000 },
      },
    ],
    queryTradeDocuments: async () => [{
      name: `${rootName}/tradeLedger/buy-aapl`,
      data: {
        id: 'buy-aapl', name: 'Apple', ticker: 'AAPL', category: '해외주식',
        currency: 'USD', side: 'buy', date: '2026-08-20', quantity: 2, price: 100,
      },
    }],
    quoteLoader: async () => [
      {
        price: 200,
        priceDate: '2026-08-28',
        priceStatus: 'confirmed-close',
        marketDayStatus: 'trading-day',
        exchangeTimezone: 'America/New_York',
        currency: 'USD',
        source: 'yahoo-historical',
      },
      null,
    ],
    fxResolver: async () => ({
      currency: 'USD', baseCurrency: 'KRW', requestedDate: '2026-08-28',
      rateDate: '2026-08-28', rate: 1350, source: 'FRANKFURTER_ECB',
    }),
    commitSnapshots: async ({ snapshots }) => {
      committedSnapshots = snapshots;
      return snapshots.length;
    },
  });

  assert.equal(result.targetDate, '2026-08-28');
  assert.equal(result.userCount, 1);
  assert.equal(result.committed, 1);
  assert.equal(committedSnapshots[0].id, 'snapshot-2026-08-28');
  assert.equal(committedSnapshots[0].data.status, 'complete');
  assert.equal(committedSnapshots[0].data.valuationValidation, 'confirmed');
  assert.equal(committedSnapshots[0].data.valuationTimestamp, '2026-08-28T22:10:00.000Z');
  assert.equal(committedSnapshots[0].data.valuationDate, '2026-08-28');
  assert.equal(committedSnapshots[0].data.generatedAt, '2026-08-28T22:10:00.000Z');
  assert.equal(committedSnapshots[0].data.assetValues[0].priceDate, '2026-08-28');
  assert.equal(committedSnapshots[0].data.assetValues[0].fxRateDate, '2026-08-28');
  assert.equal(committedSnapshots[0].data.valuationAssets[0].ticker, 'AAPL');
  assert.equal(committedSnapshots[0].data.retryOfIncomplete, false);
  assert.equal(committedSnapshots[0].data.valueKRW, 1890000);
  assert.equal(committedSnapshots[0].data.includesCash, true);
});

test('거래일 장중 가격 또는 이전 종가 fallback은 COMPLETE로 승격하지 않는다', async () => {
  let committedSnapshots = [];
  await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    now: new Date('2026-08-28T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-20' } }],
    queryDocuments: async () => [{
      name: `${rootName}/assets/us-stock`,
      data: { id: 'us-stock', name: 'Apple', ticker: 'AAPL', category: '해외주식', currency: 'USD', quantity: 2 },
    }],
    queryTradeDocuments: async () => [{
      name: `${rootName}/tradeLedger/buy-aapl`,
      data: {
        id: 'buy-aapl', name: 'Apple', ticker: 'AAPL', category: '해외주식',
        currency: 'USD', side: 'buy', date: '2026-08-20', quantity: 2, price: 100,
      },
    }],
    quoteLoader: async () => [{
      price: 199,
      priceDate: '2026-08-27',
      priceStatus: 'pending-close',
      marketDayStatus: 'unknown',
      exchangeTimezone: 'America/New_York',
      currency: 'USD',
      source: 'yahoo-historical',
    }],
    fxResolver: async () => ({
      currency: 'USD', baseCurrency: 'KRW', requestedDate: '2026-08-28',
      rateDate: '2026-08-28', rate: 1350, source: 'FRANKFURTER_ECB',
    }),
    commitSnapshots: async ({ snapshots }) => {
      committedSnapshots = snapshots;
      return snapshots.length;
    },
  });

  assert.equal(committedSnapshots[0].data.status, 'incomplete');
  assert.equal(committedSnapshots[0].data.valuationValidation, 'incomplete');
  assert.equal(committedSnapshots[0].data.missingAssets.includes('AAPL'), true);
  assert.equal(committedSnapshots[0].data.valuationIssues[0].reason, 'market-close-pending');
});

test('다음 Scheduled 실행은 사용자별 이전 INCOMPLETE 날짜를 다시 평가한다', async () => {
  let committedSnapshots = [];
  const asset = {
    id: 'us-stock', name: 'Apple', ticker: 'AAPL', category: '해외주식',
    market: 'US', currency: 'USD', quantity: 2,
  };
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    now: new Date('2026-08-29T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-20' } }],
    queryDocuments: async () => [{ name: `${rootName}/assets/us-stock`, data: asset }],
    queryTradeDocuments: async () => [{
      name: `${rootName}/tradeLedger/buy-aapl`,
      data: { ...asset, side: 'buy', date: '2026-08-20', price: 100 },
    }],
    querySnapshotDocuments: async () => [{
      name: `${rootName}/portfolioSnapshots/snapshot-2026-08-28`,
      data: {
        date: '2026-08-28',
        status: 'incomplete',
        source: 'cloudflare-cron',
        valuationAssets: [asset],
      },
    }],
    quoteLoader: async (assets, date) => assets.map(() => ({
      price: 200,
      priceDate: '2026-08-28',
      priceStatus: date === '2026-08-28' ? 'confirmed-close' : 'confirmed-close-fallback',
      marketDayStatus: date === '2026-08-28' ? 'trading-day' : 'closed',
      exchangeTimezone: 'America/New_York',
      currency: 'USD',
      source: 'yahoo-historical',
    })),
    fxResolver: async (_currency, _base, date) => ({
      currency: 'USD', baseCurrency: 'KRW', requestedDate: date,
      rateDate: '2026-08-28', rate: 1350, source: 'FRANKFURTER_ECB',
    }),
    commitSnapshots: async ({ snapshots }) => {
      committedSnapshots = snapshots;
      return snapshots.length;
    },
  });

  const retried = committedSnapshots.find((snapshot) => snapshot.data.date === '2026-08-28');
  assert.equal(result.retryCount, 1);
  assert.equal(retried.data.status, 'complete');
  assert.equal(retried.data.retryOfIncomplete, true);
  assert.equal(retried.data.assetValues[0].priceDate, '2026-08-28');
});

test('FX 미확정 Snapshot은 다음 실행에서 확정 환율을 얻으면 COMPLETE가 된다', async () => {
  const asset = {
    id: 'us-stock', name: 'Apple', ticker: 'AAPL', category: '해외주식',
    currency: 'USD', quantity: 2,
  };
  const common = {
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-20' } }],
    queryDocuments: async () => [{ name: `${rootName}/assets/us-stock`, data: asset }],
    queryTradeDocuments: async () => [{
      name: `${rootName}/tradeLedger/buy-aapl`,
      data: { ...asset, side: 'buy', date: '2026-08-20', price: 100 },
    }],
    quoteLoader: async (assets, date) => assets.map(() => ({
      price: 200,
      priceDate: '2026-08-28',
      priceStatus: date === '2026-08-28' ? 'confirmed-close' : 'confirmed-close-fallback',
      marketDayStatus: date === '2026-08-28' ? 'trading-day' : 'closed',
      exchangeTimezone: 'America/New_York',
      currency: 'USD',
      source: 'yahoo-historical',
    })),
  };
  let firstWrites = [];
  await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    ...common,
    now: new Date('2026-08-28T22:10:00.000Z'),
    fxResolver: async () => ({
      currency: 'USD', baseCurrency: 'KRW', requestedDate: '2026-08-28',
      rateDate: '2026-08-27', rate: 1340, source: 'FRANKFURTER_ECB',
    }),
    commitSnapshots: async ({ snapshots }) => {
      firstWrites = snapshots;
      return snapshots.length;
    },
  });
  assert.equal(firstWrites[0].data.status, 'incomplete');
  assert.equal(firstWrites[0].data.missingCurrencies.includes('USD'), true);

  let secondWrites = [];
  await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    ...common,
    now: new Date('2026-08-29T22:10:00.000Z'),
    querySnapshotDocuments: async () => [{
      name: `${rootName}/portfolioSnapshots/snapshot-2026-08-28`,
      data: firstWrites[0].data,
    }],
    fxResolver: async (_currency, _base, date) => ({
      currency: 'USD', baseCurrency: 'KRW', requestedDate: date,
      rateDate: '2026-08-28', rate: 1350, source: 'FRANKFURTER_ECB',
    }),
    commitSnapshots: async ({ snapshots }) => {
      secondWrites = snapshots;
      return snapshots.length;
    },
  });
  const retried = secondWrites.find((snapshot) => snapshot.data.date === '2026-08-28');
  assert.equal(retried.data.status, 'complete');
  assert.equal(retried.data.fxRates.USD.rateDate, '2026-08-28');
});

test('INCOMPLETE 재시도는 사용자별 가장 오래된 한 날짜로 제한한다', async () => {
  let writes = [];
  const incomplete = (date) => ({
    name: `${rootName}/portfolioSnapshots/snapshot-${date}`,
    data: {
      date, status: 'incomplete', source: 'cloudflare-cron',
      valuationAssets: [{ id: 'cash', name: 'KRW', category: '현금', currency: 'KRW', quantity: 1000 }],
    },
  });
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    now: new Date('2026-08-28T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-20' } }],
    queryDocuments: async () => [],
    querySnapshotDocuments: async () => [incomplete('2026-08-26'), incomplete('2026-08-27')],
    quoteLoader: async (assets) => assets.map(() => null),
    commitSnapshots: async ({ snapshots }) => {
      writes = snapshots;
      return snapshots.length;
    },
  });

  assert.equal(result.retryCount, 1);
  assert.equal(writes.some((snapshot) => snapshot.data.date === '2026-08-26'), true);
  assert.equal(writes.some((snapshot) => snapshot.data.date === '2026-08-27'), false);
});

test('가입일 이전 날짜에는 snapshot을 생성하지 않는다', async () => {
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    targetDate: '2026-08-27',
    now: new Date('2026-08-28T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-28' } }],
    queryDocuments: async () => [],
    quoteLoader: async () => [],
    commitSnapshots: async () => 0,
  });
  assert.equal(result.userCount, 0);
  assert.equal(result.committed, 0);
});

test('같은 날짜의 기존 COMPLETE Snapshot은 Scheduled Snapshot으로 덮어쓰지 않는다', async () => {
  let quoteLoaded = false;
  const result = await runDailyPortfolioSnapshots({ FIREBASE_PROJECT_ID: 'demo' }, {
    targetDate: '2026-08-28',
    now: new Date('2026-08-28T22:10:00.000Z'),
    accessToken: 'token',
    listRoots: async () => [{ name: rootName, data: { joinedAt: '2026-08-28' } }],
    queryDocuments: async () => [{
      name: `${rootName}/assets/us-stock`,
      data: { id: 'us-stock', name: 'Apple', ticker: 'AAPL', category: '해외주식', currency: 'USD', quantity: 2 },
    }],
    querySnapshotDocuments: async () => [{
      name: `${rootName}/portfolioSnapshots/snapshot-2026-08-28`,
      data: {
        date: '2026-08-28', valueKRW: 1000, includesCash: true,
        source: 'cloudflare-cron', status: 'complete', valuationBasis: 'eod',
        valuationValidation: 'confirmed',
        valuationTimestamp: '2026-08-28T22:10:00.000Z',
        generatedAt: '2026-08-28T22:10:00.000Z',
      },
    }],
    quoteLoader: async () => {
      quoteLoaded = true;
      return [];
    },
    commitSnapshots: async () => {
      throw new Error('기존 COMPLETE Snapshot을 저장하려고 했습니다.');
    },
  });

  assert.equal(result.committed, 0);
  assert.equal(quoteLoaded, false);
});
