import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalTradeRows,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  getTradeRound,
  reconcileAssetsWithTradeLedger,
  resolveNextTradeRound,
} from '../src/utils/tradeReconciliation.js';

const row = (o) => ({ name: '삼성전자', ticker: '005930', currency: 'KRW', ...o });

test('회차가 없으면 1차로 본다', () => {
  assert.equal(getTradeRound({}), 1);
  assert.equal(getTradeRound({ round: 2 }), 2);
});

test('회차가 다르면 자산 키가 분리된다', () => {
  assert.notEqual(getTradeAssetKey(row({ round: 1 })), getTradeAssetKey(row({ round: 2 })));
});

test('전량 매도 후 재매수하면 다음 회차가 열린다', () => {
  const ledger = [
    row({ round: 1, side: 'buy', date: '2025-01-02', quantity: 10, price: 70000 }),
    row({ round: 1, side: 'sell', date: '2025-03-02', quantity: 10, price: 80000 }),
  ];
  assert.equal(resolveNextTradeRound({ record: row({}), assets: [], tradeLedger: ledger }), 2);
});

test('보유 중이면 같은 회차에 합산된다', () => {
  const ledger = [row({ round: 1, side: 'buy', date: '2025-01-02', quantity: 10, price: 70000 })];
  const assets = [row({ round: 1, quantity: 10 })];
  assert.equal(resolveNextTradeRound({ record: row({}), assets, tradeLedger: ledger }), 1);
});

test('처음 사는 종목은 1차', () => {
  assert.equal(resolveNextTradeRound({ record: row({}), assets: [], tradeLedger: [] }), 1);
});

test('회차별 평단가가 섞이지 않는다', () => {
  const ledger = [
    row({ id: 'a', round: 1, side: 'buy', date: '2025-01-02', quantity: 10, price: 70000 }),
    row({ id: 'b', round: 1, side: 'sell', date: '2025-03-02', quantity: 10, price: 80000 }),
    row({ id: 'c', round: 2, side: 'buy', date: '2025-05-02', quantity: 5, price: 90000 }),
  ];
  const assets = [
    { ...row({ round: 2 }), id: 2, quantity: 5, originalAveragePrice: 90000, averagePrice: 90000, buyDate: '2025-05-02' },
  ];
  const reconciled = reconcileAssetsWithTradeLedger(assets, ledger);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].quantity, 5);
  assert.equal(reconciled[0].originalAveragePrice, 90000); // 1차 70,000이 섞이지 않아야 한다
  assert.equal(reconciled[0].buyDate, '2025-05-02');

  // 실현손익은 1차에만 잡힌다: (80000-70000)*10
  const canonical = buildCanonicalTradeRows({ tradeLedger: ledger });
  const sells = canonical.filter((r) => r.side === 'sell');
  assert.equal(sells.length, 1);
  assert.equal(sells[0].pnl, 100000);
});

test('회차를 나누지 않으면 평단가가 섞인다(회귀 확인용)', () => {
  const ledger = [
    row({ id: 'a', side: 'buy', date: '2025-01-02', quantity: 10, price: 70000 }),
    row({ id: 'b', side: 'sell', date: '2025-03-02', quantity: 10, price: 80000 }),
    row({ id: 'c', side: 'buy', date: '2025-05-02', quantity: 5, price: 90000 }),
  ];
  const position = buildPositionFromTradeRows(ledger);
  assert.equal(position.quantity, 5);
  assert.equal(position.firstBuyDate, '2025-01-02'); // 최초 매수일이 1차로 잡힘 = 사용자가 본 문제
});
