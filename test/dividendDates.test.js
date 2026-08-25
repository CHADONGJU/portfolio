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

test('국내 배당 기준일은 어떤 경우에도 뒤로 밀리지 않는다', () => {
  // 금요일 기준일. 영업일을 더하면 월요일(2026-08-03)로 밀려 기준일 이후 매수분까지
  // 배당 대상이 된다. 국내 피드는 이미 기준일을 주므로 그대로 써야 한다.
  assert.equal(getDividendEligibilityDate({ exDate: '2026-07-31', currency: 'KRW' }), '2026-07-31');
  assert.equal(getDividendEligibilityDate({ date: '2026-12-31', currency: 'KRW' }), '2026-12-31');
  assert.equal(getDividendEligibilityDate({ exDate: '2026-07-31', currency: 'JPY' }), '2026-07-31');
  assert.equal(getDividendEligibilityDate({ exDate: '2026-07-31' }), '2026-07-31');
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

test('PG August 17 official US payment is separately reported on August 18 in Korea', () => {
  const dividend = {
    exDate: '2026-07-24',
    paymentDate: '2026-08-17',
    currency: 'USD',
  };

  assert.equal(getDividendOfficialPaymentDate(dividend), '2026-08-17');
  assert.equal(getDividendReportingDate(dividend), '2026-08-18');
  assert.equal(isDividendReportingDateShifted(dividend), true);
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
