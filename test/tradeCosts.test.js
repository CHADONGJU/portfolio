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
