import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKoreanDate, koreanDateStart } from '../src/utils/dates.js';

test('trade forms use the Korean date before 09:00, including year boundaries', () => {
  assert.equal(formatKoreanDate('2026-09-07T00:30:00+09:00'), '2026-09-07');
  assert.equal(formatKoreanDate('2026-01-01T00:00:00+09:00'), '2026-01-01');
  assert.equal(formatKoreanDate('2026-09-06T14:59:59Z'), '2026-09-06');
  assert.equal(formatKoreanDate('2026-09-06T15:00:00Z'), '2026-09-07');
});

test('calendar start is Korean midnight expressed in UTC', () => {
  assert.equal(koreanDateStart('2026-09-01').toISOString(), '2026-08-31T15:00:00.000Z');
});
