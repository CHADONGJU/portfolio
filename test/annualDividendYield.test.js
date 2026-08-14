import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAnnualDividendYield } from '../src/utils/annualDividendYield.js';

test('annualizes a monthly net dividend against current value', () => {
  const result = calculateAnnualDividendYield({
    expectedPaymentAmount: 50,
    intervalMonths: 1,
    currentValue: 10000,
  });

  assert.equal(result.expectedAnnualAmount, 600);
  assert.equal(result.annualDividendYieldPercent, 6);
});

test('annualizes a quarterly net dividend without treating it as monthly', () => {
  const result = calculateAnnualDividendYield({
    expectedPaymentAmount: 100,
    intervalMonths: 3,
    currentValue: 20000,
  });

  assert.equal(result.expectedAnnualAmount, 400);
  assert.equal(result.annualDividendYieldPercent, 2);
});

test('does not show a yield when there is no current holding value', () => {
  const result = calculateAnnualDividendYield({
    expectedPaymentAmount: 100,
    intervalMonths: 3,
    currentValue: 0,
  });

  assert.equal(result.expectedAnnualAmount, 0);
  assert.equal(result.annualDividendYieldPercent, null);
});
