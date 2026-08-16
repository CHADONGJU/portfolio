import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DIVIDEND_INTERVAL_MONTHS,
  addMonthsClamped,
  estimateDividendIntervalMonths,
} from '../src/utils/dividendInterval.js';

const date = (value) => new Date(`${value}T00:00:00`);

test('배당 간격으로 주기를 추정한다', () => {
  assert.equal(estimateDividendIntervalMonths(date('2025-12-31'), date('2026-01-31')), 1);
  assert.equal(estimateDividendIntervalMonths(date('2025-10-15'), date('2026-01-15')), 3);
  assert.equal(estimateDividendIntervalMonths(date('2025-07-15'), date('2026-01-15')), 6);
  assert.equal(estimateDividendIntervalMonths(date('2025-01-15'), date('2026-01-15')), 12);
});

test('판단할 수 없으면 분기로 본다', () => {
  assert.equal(estimateDividendIntervalMonths(null, date('2026-01-15')), DEFAULT_DIVIDEND_INTERVAL_MONTHS);
  assert.equal(estimateDividendIntervalMonths(date('invalid'), date('2026-01-15')), DEFAULT_DIVIDEND_INTERVAL_MONTHS);
  assert.equal(estimateDividendIntervalMonths(undefined, undefined), DEFAULT_DIVIDEND_INTERVAL_MONTHS);
  // 60일 간격은 어떤 구간에도 들어맞지 않는다.
  assert.equal(estimateDividendIntervalMonths(date('2025-11-16'), date('2026-01-15')), DEFAULT_DIVIDEND_INTERVAL_MONTHS);
});

test('월 이동이 말일을 넘겨 다음 달을 건너뛰지 않는다', () => {
  // setMonth(getMonth() + 1)이었다면 3월 3일이 되어 2월이 통째로 사라진다.
  assert.equal(addMonthsClamped(date('2026-01-31'), 1).getMonth() + 1, 2);
  assert.equal(addMonthsClamped(date('2026-01-31'), 1).getDate(), 28);
  assert.equal(addMonthsClamped(date('2024-01-31'), 1).getDate(), 29); // 윤년
  assert.equal(addMonthsClamped(date('2026-03-31'), 1).getDate(), 30);
  assert.equal(addMonthsClamped(date('2026-01-15'), 3).getMonth() + 1, 4);
});

test('연도 경계를 넘어서도 정확하다', () => {
  const next = addMonthsClamped(date('2026-11-30'), 3);
  assert.equal(next.getFullYear(), 2027);
  assert.equal(next.getMonth() + 1, 2);
  assert.equal(next.getDate(), 28);

  const previous = addMonthsClamped(date('2026-01-31'), -1);
  assert.equal(previous.getFullYear(), 2025);
  assert.equal(previous.getMonth() + 1, 12);
  assert.equal(previous.getDate(), 31);
});
