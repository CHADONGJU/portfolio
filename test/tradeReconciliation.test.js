import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionFromTradeRows } from '../src/utils/tradeReconciliation.js';

test('매매 수수료와 세금을 실현손익에 반영한다', () => {
  const position = buildPositionFromTradeRows([
    {
      id: 'buy',
      name: 'TEST',
      side: 'buy',
      currency: 'USD',
      quantity: 10,
      price: 100,
      fee: 1,
      tax: 0,
      exchangeRate: 1300,
      date: '2025-01-01',
    },
    {
      id: 'sell',
      name: 'TEST',
      side: 'sell',
      currency: 'USD',
      quantity: 4,
      price: 120,
      fee: 1,
      tax: 2,
      exchangeRate: 1400,
      date: '2025-02-01',
    },
  ]);

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.ok(Math.abs(sell.pnl - 76.6) < 0.000001);
  assert.equal(sell.pnlKRW, 147280);
  assert.equal(position.quantity, 6);
  assert.equal(position.averagePrice, 100);
});

test('부분 매도 후 남은 평균 체결가는 유지된다', () => {
  const position = buildPositionFromTradeRows([
    { id: 'a', name: 'TEST', side: 'buy', quantity: 5, price: 100, date: '2025-01-01' },
    { id: 'b', name: 'TEST', side: 'buy', quantity: 5, price: 120, date: '2025-01-02' },
    { id: 'c', name: 'TEST', side: 'sell', quantity: 2, price: 130, date: '2025-02-01' },
  ]);

  assert.equal(position.quantity, 8);
  assert.equal(position.averagePrice, 110);
});
