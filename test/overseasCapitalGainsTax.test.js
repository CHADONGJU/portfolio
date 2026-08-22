import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateOverseasCapitalGainsTax } from '../src/utils/overseasCapitalGainsTax.js';

const usdSell = (overrides = {}) => ({
  side: 'sell',
  category: '해외주식',
  currency: 'USD',
  date: '2026-03-02',
  price: 200,
  matchedQuantity: 10,
  fxRate: 1400,
  krwCostRemoved: 1400000,
  brokerFee: 0,
  sellTax: 0,
  ...overrides,
});

test('기본공제 250만원을 넘지 않으면 세금이 없다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell()],
  });

  assert.equal(result.netGainKRW, 1400000);
  assert.equal(result.taxBaseKRW, 0);
  assert.equal(result.taxKRW, 0);
  assert.equal(result.remainingDeductionKRW, 1100000);
});

test('같은 해 해외 종목 손익은 서로 통산한다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [
      usdSell({ price: 500, krwCostRemoved: 1400000 }),
      usdSell({ date: '2026-09-01', price: 50, fxRate: 1300, krwCostRemoved: 2000000 }),
    ],
  });

  // (500*10*1400 - 1,400,000) + (50*10*1300 - 2,000,000) = 5,600,000 + (-1,350,000)
  assert.equal(result.netGainKRW, 4250000);
  assert.equal(result.gainKRW, 5600000);
  assert.equal(result.lossKRW, -1350000);
  assert.equal(result.taxBaseKRW, 1750000);
  assert.equal(Math.round(result.taxKRW), 385000);
});

test('국내주식과 현금은 통산 대상에서 제외한다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [
      usdSell({ price: 500 }),
      { side: 'sell', category: '국내주식', currency: 'KRW', date: '2026-04-01', price: 100000, matchedQuantity: 100, krwCostRemoved: 1000000 },
      { side: 'sell', category: '현금', currency: 'USD', date: '2026-04-01', price: 1, matchedQuantity: 10000, fxRate: 1400, krwCostRemoved: 1 },
    ],
  });

  assert.equal(result.tradeCount, 1);
  assert.equal(result.netGainKRW, 5600000);
});

test('환차익도 과세 대상이라 매도일 환율로 양도가액을 환산한다', () => {
  // 달러로는 본전(200 → 200)이지만 매수일 1,000원 → 매도일 1,500원이면 환차익이 남는다.
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 200, fxRate: 1500, krwCostRemoved: 2000000 })],
  });

  assert.equal(result.netGainKRW, 1000000);
});

test('매도 수수료와 제세금은 필요경비로 빼준다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 500, brokerFee: 10 })],
  });

  assert.equal(result.netGainKRW, 5600000 - (10 * 1400));
});

test('다른 해의 매도는 합산하지 않는다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ date: '2025-12-31', price: 500 })],
  });

  assert.equal(result.tradeCount, 0);
  assert.equal(result.taxKRW, 0);
});

test('환율이 없는 옛 기록은 현재 환율로 추정하고 추정 표시를 남긴다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ fxRate: 0, krwCostRemoved: null, buyPrice: 100 })],
    resolveKrwRate: () => 1350,
  });

  assert.equal(result.estimated, true);
  assert.equal(result.netGainKRW, (200 - 100) * 10 * 1350);
});

test('원화 취득원가를 모르면 현지 통화 원가를 매도일 환율로 근사한다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 200, krwCostRemoved: null, nativeCostRemoved: 1000 })],
  });

  assert.equal(result.netGainKRW, (200 * 10 - 1000) * 1400);
  assert.equal(result.estimated, true);
  assert.equal(result.unresolvedCount, 0);
});

test('취득가액을 전혀 알 수 없는 매도는 계산에서 뺀다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [{
      side: 'sell',
      category: '해외주식',
      currency: 'USD',
      date: '2026-03-02',
      price: 200,
      quantity: 10,
      matchedQuantity: 0,
      fxRate: 1400,
    }],
  });

  // 예전에는 취득가액 0으로 봐서 매도대금 전액(2,800,000원)이 양도차익이 됐다.
  assert.equal(result.tradeCount, 0);
  assert.equal(result.netGainKRW, 0);
  assert.equal(result.taxKRW, 0);
  assert.equal(result.unresolvedCount, 1);
});

test('일부만 매칭된 매도는 수수료도 매칭 비율만큼만 필요경비로 뺀다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 500, quantity: 20, matchedQuantity: 10, brokerFee: 20 })],
  });

  assert.equal(result.netGainKRW, 5600000 - (10 * 1400));
});

test('보유 원장과 수량이 맞지 않는 매도는 빠진 건으로 표시한다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 500, quantity: 20, matchedQuantity: 6 })],
  });

  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.estimated, true);
});

test('환율을 구하지 못한 매도도 조용히 빼지 않는다', () => {
  const result = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ currency: 'HKD', fxRate: 0 })],
  });

  assert.equal(result.tradeCount, 0);
  assert.equal(result.unresolvedCount, 1);
});

test('매수 수수료도 취득 부대비용이라 필요경비로 뺀다', () => {
  const withKrwFee = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 500, krwBuyFeeRemoved: 13000 })],
  });
  assert.equal(withKrwFee.netGainKRW, 5600000 - 13000);

  // 원화 환산값이 없으면 현지 통화 수수료를 매도일 환율로 근사한다.
  const withNativeFee = calculateOverseasCapitalGainsTax({
    year: 2026,
    rows: [usdSell({ price: 500, buyFeeRemoved: 10 })],
  });
  assert.equal(withNativeFee.netGainKRW, 5600000 - (10 * 1400));
});
