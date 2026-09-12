import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../src/utils/formatters.js';

test('1원 미만 손실이 "₩-0"으로 찍히지 않는다', () => {
  // Math.round(-0.4)는 -0이고, (-0).toLocaleString()은 "-0"이다.
  assert.equal(formatMoney(-0.4, 'KRW'), '₩0');
  assert.equal(formatMoney(-0.4, 'JPY'), '¥0');
});

test('실제 손익은 부호와 자릿수를 그대로 유지한다', () => {
  assert.equal(formatMoney(-1234, 'KRW'), '₩-1,234');
  assert.equal(formatMoney(1234.6, 'KRW'), '₩1,235');
  assert.equal(formatMoney(-12.345, 'USD'), '$-12.35');
  assert.equal(formatMoney(null, 'KRW'), '0');
});
