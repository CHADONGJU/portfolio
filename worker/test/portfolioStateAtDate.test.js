import assert from 'node:assert/strict';
import test from 'node:test';

import { reconstructPortfolioAssetsAtDate } from '../src/portfolioStateAtDate.js';

const stock = {
  id: 'aapl', name: 'Apple', ticker: 'AAPL', category: '해외주식',
  currency: 'USD', round: 1, quantity: 15,
};
const cash = { id: 'usd-cash', name: 'USD', category: '현금', currency: 'USD', quantity: 1000 };
const buy = (date, quantity) => ({ ...stock, side: 'buy', date, quantity, price: 100 });

test('D 이후 거래를 현재 수량에 섞지 않고 tradeLedger를 D까지만 replay한다', () => {
  const result = reconstructPortfolioAssetsAtDate({
    assets: [stock],
    tradeLedger: [buy('2026-08-28', 10), buy('2026-08-29', 5)],
    targetDate: '2026-08-28',
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.assets[0].quantity, 10);
  assert.equal(result.assets[0].stateSource, 'trade-ledger-replay');
});

test('현금은 D 이후 등록 거래·입출금이 없을 때만 현재 잔액을 D 잔액으로 사용한다', () => {
  const result = reconstructPortfolioAssetsAtDate({
    assets: [{ ...stock, quantity: 10 }, cash],
    tradeLedger: [buy('2026-08-28', 10)],
    capitalFlows: [{ date: '2026-08-28', type: 'deposit', amount: 1000 }],
    targetDate: '2026-08-28',
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.assets.find((asset) => asset.category === '현금').quantity, 1000);
});

test('현금이 있는데 D 이후 이벤트가 있으면 현재 현금을 과거 D 잔액으로 꾸미지 않는다', () => {
  const result = reconstructPortfolioAssetsAtDate({
    assets: [{ ...stock, quantity: 15 }, cash],
    tradeLedger: [buy('2026-08-28', 10), buy('2026-08-29', 5)],
    capitalFlows: [{ date: '2026-08-29', type: 'deposit', amount: 1000 }],
    targetDate: '2026-08-28',
  });

  assert.equal(result.status, 'incomplete');
  assert.equal(result.issues.some((issue) => issue.reason === 'cash-state-after-target-ambiguous'), true);
});

test('시장자산 원장이 없으면 현재 수량을 사용하더라도 COMPLETE로 승격하지 않는다', () => {
  const result = reconstructPortfolioAssetsAtDate({ assets: [stock], targetDate: '2026-08-28' });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.issues[0].reason, 'trade-ledger-missing');
});

test('필수 식별값이 빠져 replay할 수 없는 원장은 자산을 조용히 누락시키지 않는다', () => {
  const result = reconstructPortfolioAssetsAtDate({
    assets: [stock],
    tradeLedger: [{ ...buy('2026-08-28', 10), name: '' }],
    targetDate: '2026-08-28',
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.assets.length, 1);
  assert.equal(result.issues[0].reason, 'trade-ledger-replay-invalid');
});
