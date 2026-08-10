import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDividendEligibilityDate,
  getDividendOfficialPaymentDate,
  getDividendReportingDate,
  isDividendReportingDateShifted,
} from '../src/utils/dividendDates.js';

test('미국 배당 기준일은 한국 거래원장 날짜로 하루 이동한다', () => {
  assert.equal(getDividendEligibilityDate({ exDate: '2025-06-02', currency: 'USD' }), '2025-06-03');
  assert.equal(getDividendEligibilityDate({ exDate: '2026-07-31', currency: 'KRW' }), '2026-07-31');
});

test('SPY July 31 US payment is reported in August in Korea', () => {
  const dividend = {
    exDate: '2026-06-18',
    paymentDate: '2026-07-31',
    currency: 'USD',
  };

  assert.equal(getDividendOfficialPaymentDate(dividend), '2026-07-31');
  assert.equal(getDividendReportingDate(dividend), '2026-08-01');
  assert.equal(isDividendReportingDateShifted(dividend), true);
});

test('VZ August 3 US payment stays in the August reporting month', () => {
  assert.equal(getDividendReportingDate({
    exDate: '2026-07-10',
    paymentDate: '2026-08-03',
    currency: 'USD',
  }), '2026-08-04');
});

test('an explicitly recorded payment date is not shifted', () => {
  assert.equal(getDividendReportingDate({
    exDate: '2026-07-10',
    paymentDate: '2026-08-03',
    actualPaymentDate: '2026-08-05',
    currency: 'USD',
  }), '2026-08-05');
});

test('falls back to the ex-dividend date when payment date is unavailable', () => {
  assert.equal(getDividendReportingDate({
    date: '2026-07-10',
    currency: 'USD',
  }), '2026-07-10');
});
