import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalTradeRows } from '../src/utils/tradeReconciliation.js';
import { buildTradeSummary } from '../src/utils/tradeSummary.js';

test('매도 3건의 누락 손익을 매수 원가로 계산하고 매도대금을 모두 합산한다', () => {
  const tradeLedger = [
    {
      id: 'qcom-buy',
      name: 'QCOM',
      ticker: 'QCOM',
      side: 'buy',
      date: '2026-06-03',
      quantity: 2,
      price: 138.12,
      currency: 'USD',
      fxRate: 1350,
    },
    {
      id: 'qcom-sell',
      name: 'QCOM',
      ticker: 'QCOM',
      side: 'sell',
      date: '2026-07-09',
      quantity: 2,
      price: 183.4,
      currency: 'USD',
      fxRate: 1400,
    },
    {
      id: 'gev-buy',
      name: 'GEV',
      ticker: 'GEV',
      side: 'buy',
      date: '2026-06-03',
      quantity: 1,
      price: 863.15,
      currency: 'USD',
      fxRate: 1350,
    },
    {
      id: 'gev-sell',
      name: 'GEV',
      ticker: 'GEV',
      side: 'sell',
      date: '2026-06-09',
      quantity: 1,
      price: 883.7861,
      currency: 'USD',
      fxRate: 1380,
    },
    {
      id: 'etn-buy-1',
      name: '신한 인버스 코스피 200 선물 ETN',
      ticker: '500061',
      side: 'buy',
      date: '2026-01-29',
      quantity: 61,
      price: 4855,
      currency: 'KRW',
    },
    {
      id: 'etn-buy-2',
      name: '신한 인버스 코스피 200 선물 ETN',
      ticker: '500061',
      side: 'buy',
      date: '2026-05-29',
      quantity: 10,
      price: 2470,
      currency: 'KRW',
    },
    {
      id: 'etn-sell',
      name: '신한 인버스 코스피 200 선물 ETN',
      ticker: '500061',
      side: 'sell',
      date: '2026-07-21',
      quantity: 71,
      price: 2835,
      currency: 'KRW',
      pnl: -119570,
    },
  ];

  const canonicalRows = buildCanonicalTradeRows({ tradeLedger });
  const sellRows = canonicalRows.filter((row) => row.side === 'sell');
  const summary = buildTradeSummary(canonicalRows, 1500, 9.5, { USD: 1500 });

  assert.equal(sellRows.length, 3);
  assert.equal(sellRows.find((row) => row.ticker === 'QCOM').pnl, 90.56);
  assert.ok(Math.abs(sellRows.find((row) => row.ticker === 'GEV').pnl - 20.6361) < 0.000001);
  assert.equal(sellRows.find((row) => row.ticker === '500061').pnl, -119570);
  assert.equal(summary.totalSellCount, 3);
  assert.equal(
    summary.totalSellAmount,
    (183.4 * 2 * 1400) + (883.7861 * 1380) + (2835 * 71),
  );
});
