import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSellCosts,
  getDomesticStockSellTaxRatePercent,
  getSellTaxRatePercent,
} from '../src/utils/tradeCosts.js';

test('국내주식 제세금율은 매도일 기준으로 계산한다', () => {
  assert.equal(getDomesticStockSellTaxRatePercent('2023-12-29'), 0.2);
  assert.equal(getDomesticStockSellTaxRatePercent('2024-12-30'), 0.18);
  assert.equal(getDomesticStockSellTaxRatePercent('2025-12-26'), 0.15);
  assert.equal(getDomesticStockSellTaxRatePercent('2025-12-29'), 0.2);
  assert.equal(getDomesticStockSellTaxRatePercent('2026-08-22'), 0.2);
});

test('국내주식 매도 제세금은 매도금액 기준이고 손익과 무관하다', () => {
  const result = calculateSellCosts({
    category: '국내주식',
    quantity: 100,
    sellPrice: 51000,
    buyPrice: 60000,
    brokerFeeRatePercent: 0,
    sellTaxRatePercent: 0.2,
  });

  assert.equal(result.grossSellAmount, 5100000);
  assert.equal(result.sellTax, 10200);
  assert.equal(result.grossPnl, -900000);
  assert.equal(result.netPnl, -910200);
});

test('해외주식 매도 모달은 국내 제세금을 적용하지 않는다', () => {
  const asset = { category: '해외주식' };
  const result = calculateSellCosts({
    category: asset.category,
    quantity: 10,
    sellPrice: 120,
    buyPrice: 100,
    brokerFeeRatePercent: 0.25,
    sellTaxRatePercent: 0.2,
  });

  assert.equal(getSellTaxRatePercent(asset, '2026-08-22'), 0);
  assert.equal(result.sellTax, 0);
  assert.equal(result.brokerFee, 3);
  assert.equal(result.netPnl, 197);
});

test('국내 상장 ETF는 증권거래세 면제 대상이라 기본 제세금율이 0이다', () => {
  assert.equal(getSellTaxRatePercent({ category: '국내주식', name: 'KODEX 200' }, '2026-08-22'), 0);
  assert.equal(getSellTaxRatePercent({ category: '국내주식', name: 'TIGER 미국S&P500' }, '2026-08-22'), 0);
  assert.equal(getSellTaxRatePercent({ category: '국내주식', name: '삼성전자' }, '2026-08-22'), 0.2);
});

test('표에 없는 과거 매도일도 그 시절 세율로 계산한다', () => {
  assert.equal(getDomesticStockSellTaxRatePercent('2022-06-15'), 0.23);
  assert.equal(getDomesticStockSellTaxRatePercent('2021-01-04'), 0.23);
  assert.equal(getDomesticStockSellTaxRatePercent('2019-12-02'), 0.25);
  assert.equal(getDomesticStockSellTaxRatePercent('2015-03-02'), 0.3);
});

test('브랜드명이 앞에 붙은 이름만 ETF로 보고, 일반 종목은 거래세를 매긴다', () => {
  const domestic = (name) => getSellTaxRatePercent({ category: '국내주식', name }, '2026-08-22');
  assert.equal(domestic('BNK금융지주'), 0.2);
  assert.equal(domestic('파워로직스'), 0.2);
  assert.equal(domestic('SOLUM'), 0.2);
  assert.equal(domestic('SOL 미국배당다우존스'), 0);
  assert.equal(domestic('ACE 미국나스닥100'), 0);
  assert.equal(domestic('미래에셋 TIGER ETF'), 0);
});

test('증권거래세 인하는 2019-06-03 매매분부터 적용한다', () => {
  assert.equal(getDomesticStockSellTaxRatePercent('2019-06-02'), 0.3);
  assert.equal(getDomesticStockSellTaxRatePercent('2019-06-03'), 0.25);
});
