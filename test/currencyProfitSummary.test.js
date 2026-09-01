import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeUnrealizedProfitByCurrency } from '../src/utils/currencyProfitSummary.js';

test('첨부 화면의 종목별 원화·달러 손익을 통화별로 정확히 합산한다', () => {
  const krwProfits = [-180000, 43000, -104910, -40640, -66575];
  const usdProfits = [
    321.95, -626.62, 92.58, 439.02, -147.50,
    -396.62, -78.17, 162.72, 241.70, 80.90,
    4.70, 190.23, 35.62, 28.54, -9.75,
    -103.83, -95.36, 0.99,
  ];
  const result = summarizeUnrealizedProfitByCurrency([
    ...krwProfits.map((profitNative) => ({ category: '국내주식', currency: 'KRW', profitNative })),
    ...usdProfits.map((profitNative) => ({ category: '해외주식', currency: 'USD', profitNative })),
  ]);

  assert.deepEqual(result, [
    { currency: 'KRW', assetCount: 5, label: '원화', amount: -349125 },
    { currency: 'USD', assetCount: 18, label: '달러', amount: 141.10 },
  ]);
});

test('각 종목의 화면 표시 자릿수로 먼저 반올림한 뒤 합산한다', () => {
  const result = summarizeUnrealizedProfitByCurrency([
    { category: '국내주식', currency: 'KRW', profitNative: 10.49 },
    { category: '국내주식', currency: 'KRW', profitNative: 10.51 },
    { category: '해외주식', currency: 'USD', profitNative: 1.005 },
    { category: '해외주식', currency: 'USD', profitNative: -0.004 },
  ]);

  assert.equal(result[0].amount, 21);
  assert.equal(result[1].amount, 1.01);
});

test('현금은 제외하고 엔화 등 다른 통화는 달러와 섞지 않는다', () => {
  const result = summarizeUnrealizedProfitByCurrency([
    { category: '현금', currency: 'KRW', profitNative: 999999 },
    { category: '해외주식', currency: 'JPY', profitNative: -100.6 },
  ]);

  assert.deepEqual(result, [
    { currency: 'KRW', assetCount: 0, label: '원화', amount: 0 },
    { currency: 'USD', assetCount: 0, label: '달러', amount: 0 },
    { currency: 'JPY', assetCount: 1, label: '엔화', amount: -101 },
  ]);
});
