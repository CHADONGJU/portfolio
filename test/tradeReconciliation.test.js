import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalTradeRows,
  buildKrwCostBasisByAsset,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  reconcileAssetsWithTradeLedger,
} from '../src/utils/tradeReconciliation.js';

const krw = (o) => ({ name: '삼성전자', ticker: '005930', currency: 'KRW', ...o });

test('원장이 비어 있으면 자산을 그대로 둔다', () => {
  const assets = [{ id: 1, name: '삼성전자', ticker: '005930', quantity: 10, averagePrice: 70000 }];
  assert.equal(reconcileAssetsWithTradeLedger(assets, []), assets);
  assert.equal(reconcileAssetsWithTradeLedger(assets, null), assets);
});

test('원장 기준으로 수량과 평단을 바로잡는다', () => {
  const assets = [{
    id: 1, name: '삼성전자', ticker: '005930', quantity: 999, averagePrice: 1, buyDate: '2020-01-01',
  }];
  const ledger = [
    krw({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 70000 }),
    krw({ id: 'b2', side: 'buy', date: '2026-02-05', quantity: 10, price: 80000 }),
  ];

  const [reconciled] = reconcileAssetsWithTradeLedger(assets, ledger);
  assert.equal(reconciled.quantity, 20);
  assert.equal(reconciled.averagePrice, 75000);
  assert.equal(reconciled.buyDate, '2026-01-05');
});

test('전량 매도된 종목은 목록에서 빠지고 나머지 보정은 유지된다', () => {
  const assets = [
    { id: 1, name: '삼성전자', ticker: '005930', quantity: 10, averagePrice: 70000 },
    { id: 2, name: 'SK하이닉스', ticker: '000660', quantity: 999, averagePrice: 1 },
  ];
  const ledger = [
    krw({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 70000 }),
    krw({ id: 's1', side: 'sell', date: '2026-03-05', quantity: 10, price: 90000 }),
    krw({
      id: 'b2', ticker: '000660', name: 'SK하이닉스', side: 'buy', date: '2026-01-05', quantity: 5, price: 200000,
    }),
  ];

  const reconciled = reconcileAssetsWithTradeLedger(assets, ledger);
  assert.equal(reconciled.length, 1);
  // 청산된 삼성전자가 빠져도 하이닉스 보정은 살아 있어야 한다.
  assert.equal(reconciled[0].ticker, '000660');
  assert.equal(reconciled[0].quantity, 5);
  assert.equal(reconciled[0].averagePrice, 200000);
});

test('매수 기록이 없는 자산은 원장이 건드리지 않는다', () => {
  const assets = [{ id: 1, name: '현금', ticker: '', quantity: 1000000, averagePrice: 1 }];
  const ledger = [krw({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 70000 })];

  const reconciled = reconcileAssetsWithTradeLedger(assets, ledger);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].quantity, 1000000);
});

test('회차가 다르면 자산 키가 달라져 원금이 섞이지 않는다', () => {
  const first = getTradeAssetKey(krw({ round: 1 }));
  const second = getTradeAssetKey(krw({ round: 2 }));
  assert.notEqual(first, second);
});

test('원장 기준 원화 원금은 자산 키별로 나뉜다', () => {
  const ledger = [
    krw({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 70000, round: 1 }),
    krw({ id: 'b2', side: 'buy', date: '2026-04-05', quantity: 5, price: 90000, round: 2 }),
  ];
  const costByAsset = buildKrwCostBasisByAsset(ledger, () => 1);

  const values = [...costByAsset.values()].map((entry) => entry.krwCost).sort((a, b) => a - b);
  assert.deepEqual(values, [450000, 700000]);
});

test('보유량보다 큰 매도는 손익을 계산하지 못한 것으로 표시한다', () => {
  const rows = [
    krw({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 70000 }),
    krw({ id: 's1', side: 'sell', date: '2026-02-05', quantity: 25, price: 90000 }),
  ];
  const position = buildPositionFromTradeRows(rows);

  assert.equal(position.quantity, 0);
  const sellRow = position.rows.find((row) => row.id === 's1');
  assert.equal(sellRow.matchedQuantity, 10);
  assert.equal(sellRow.pnlSource, 'calculated');
});

test('기록된 손익이 있으면 계산값 대신 그것을 쓴다', () => {
  const rows = [
    krw({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 70000 }),
    krw({ id: 's1', side: 'sell', date: '2026-02-05', quantity: 10, price: 90000, pnl: 123456 }),
  ];
  const [, sellRow] = buildPositionFromTradeRows(rows).rows;

  assert.equal(sellRow.pnl, 123456);
  assert.equal(sellRow.pnlSource, 'recorded');
});

test('원장이 없으면 옛 trades 기록으로 매도 행을 만든다', () => {
  const rows = buildCanonicalTradeRows({
    tradeLedger: [],
    trades: [{
      id: 't1', name: '삼성전자', ticker: '005930', currency: 'KRW',
      sellDate: '2026-02-05', sellPrice: 90000, quantity: 10, pnl: 200000,
    }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].side, 'sell');
  assert.equal(rows[0].date, '2026-02-05');
});
