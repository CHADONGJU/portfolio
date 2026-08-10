import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDividendAmounts } from '../src/utils/dividendCalculation.js';

test('calculates US withholding from official per-share distribution and eligible shares', () => {
  const result = calculateDividendAmounts({
    perShareGrossAmount: 0.7075,
    quantity: 50,
    withholdingRate: 0.15,
  });

  assert.equal(result.grossAmount, 35.375);
  assert.equal(result.taxAmount, 5.3062499999999995);
  assert.equal(result.amount, 30.06875);
});

test('ISA 계좌는 공식 분배금에 국내 원천징수를 즉시 적용하지 않는다', () => {
  const nifty = calculateDividendAmounts({
    perShareGrossAmount: 76,
    taxableBasePerShare: 76,
    quantity: 120,
    withholdingRate: 0.154,
    skipCalculatedWithholding: true,
  });
  const tata = calculateDividendAmounts({
    perShareGrossAmount: 60,
    taxableBasePerShare: 0,
    quantity: 111,
    withholdingRate: 0.154,
    skipCalculatedWithholding: true,
  });

  assert.equal(nifty.amount, 9120);
  assert.equal(tata.amount, 6660);
  assert.equal(nifty.amount + tata.amount, 15780);
});

test('일반계좌 Nifty50은 과세표준에 15.4%를 적용한다', () => {
  const result = calculateDividendAmounts({
    perShareGrossAmount: 76,
    taxableBasePerShare: 76,
    quantity: 120,
    withholdingRate: 0.154,
  });

  assert.equal(result.grossAmount, 9120);
  assert.equal(result.taxAmount, 1404.48);
  assert.equal(result.amount, 7715.52);
});

test('ISA여도 원천에서 이미 차감된 해외 배당 세금은 되돌리지 않는다', () => {
  const result = calculateDividendAmounts({
    perShareGrossAmount: 1,
    perShareNetAmount: 0.85,
    quantity: 10,
    skipCalculatedWithholding: true,
  });

  assert.equal(result.grossAmount, 10);
  assert.equal(result.taxAmount, 1.5);
  assert.equal(result.amount, 8.5);
});

test('taxes only the smaller taxable base when a source supplies it', () => {
  const result = calculateDividendAmounts({
    perShareGrossAmount: 100,
    taxableBasePerShare: 40,
    quantity: 10,
    withholdingRate: 0.154,
  });

  assert.equal(result.taxableAmount, 400);
  assert.equal(result.taxAmount, 61.6);
  assert.equal(result.amount, 938.4);
});

test('TIGER 코스피 공식 주당 60원 기준 계산값은 실제 입금과 별도로 유지한다', () => {
  const result = calculateDividendAmounts({
    perShareGrossAmount: 60,
    taxableBasePerShare: 60,
    quantity: 17,
    withholdingRate: 0.154,
  });

  assert.equal(result.grossAmount, 1020);
  assert.ok(Math.abs(result.taxAmount - 157.08) < 0.0000001);
  assert.ok(Math.abs(result.amount - 862.92) < 0.0000001);
});
