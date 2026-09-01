import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePortfolioValuation } from '../src/portfolioValuation.js';

test('국내/해외 주식과 원화/외화 현금을 모두 Portfolio Value에 포함한다', () => {
  const result = calculatePortfolioValuation({
    assets: [
      { id: 'kr-stock', ticker: '005930', category: '국내주식', currency: 'KRW', quantity: 10 },
      { id: 'us-stock', ticker: 'AAPL', category: '해외주식', currency: 'USD', quantity: 2 },
      { id: 'krw-cash', category: '현금', currency: 'KRW', quantity: 1000000 },
      { id: 'usd-cash', category: '현금', currency: 'USD', quantity: 1000 },
    ],
    quotes: [
      { price: 70000, currency: 'KRW', source: 'tradingview' },
      { price: 200, currency: 'USD', source: 'tradingview' },
      null,
      null,
    ],
    fxRates: new Map([['USD', { rate: 1350 }]]),
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.valueKRW, 3590000);
  assert.equal(result.includesCash, true);
});

test('시세 또는 환율 누락을 기존 숫자로 숨기지 않고 incomplete로 남긴다', () => {
  const result = calculatePortfolioValuation({
    assets: [{ id: 'asset', ticker: 'AAPL', category: '해외주식', currency: 'USD', quantity: 2 }],
    quotes: [null],
    fxRates: {},
  });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.missingCurrencies, ['USD']);
});
