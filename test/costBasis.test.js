import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalTradeRows,
  buildKrwCostBasisByAsset,
  buildPositionFromTradeRows,
  getTradeAssetKey,
} from '../src/utils/tradeReconciliation.js';

const usd = (o) => ({ name: 'SOXL', ticker: 'SOXL', currency: 'USD', ...o });
// 매수일 환율이 있으면 그것을, 없으면 0(모름)을 돌려준다.
const rateOf = (row) => (row.currency === 'KRW' ? 1 : (Number(row.fxRate) > 0 ? Number(row.fxRate) : 0));

test('원금은 오늘 환율이 아니라 매수 시점 환율로 쌓인다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 40, price: 25, fxRate: 1450 }),
    usd({ id: 'b', side: 'buy', date: '2025-04-10', quantity: 30, price: 20, fxRate: 1420 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });

  assert.equal(position.quantity, 70);
  assert.equal(position.krwCost, 40 * 25 * 1450 + 30 * 20 * 1420); // 1,450,000 + 852,000
  assert.equal(position.hasExactKrwCost, true);

  // 오늘 환율(1320)로 환산한 기존 방식은 훨씬 작게 나온다 = 사용자가 본 차이
  const todayRateEquivalent = (40 * 25 + 30 * 20) * 1320;
  assert.ok(position.krwCost > todayRateEquivalent);
});

test('부분 매도하면 원금이 수량에 비례해 줄어든다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 100, price: 20, fxRate: 1400 }),
    usd({ id: 'b', side: 'sell', date: '2025-06-10', quantity: 40, price: 25, fxRate: 1300 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });

  assert.equal(position.quantity, 60);
  assert.equal(position.krwCost, 60 * 20 * 1400); // 1,680,000
});

test('원화 실현손익에 환차손익이 섞이지 않는다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 100, price: 20, fxRate: 1400 }),
    usd({ id: 'b', side: 'sell', date: '2025-06-10', quantity: 100, price: 25, fxRate: 1300 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });
  const sell = position.rows.find((row) => row.side === 'sell');

  assert.equal(sell.pnl, 500); // 달러 기준 +$500
  // 매도일 환율(1300)이 아니라 매수 시점 환율(1400)로만 환산한다.
  assert.equal(sell.krwPnl, 500 * 1400);
});

test('매도일 환율이 어떻든 원화 실현손익은 그대로다', () => {
  const build = (sellFxRate) => {
    const rows = [
      usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 100, price: 20, fxRate: 1400 }),
      usd({ id: 'b', side: 'sell', date: '2025-06-10', quantity: 100, price: 25, fxRate: sellFxRate }),
    ];
    return buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf })
      .rows.find((row) => row.side === 'sell').krwPnl;
  };

  assert.equal(build(1200), build(1500));
});

test('매수 시점 환율을 모르면 원금을 정확하다고 하지 않는다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 10, price: 20, fxRate: 0 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });
  assert.equal(position.hasExactKrwCost, false);
});

test('환율 해석기를 안 넘기면 예전 동작 그대로다', () => {
  const rows = [usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 10, price: 20, fxRate: 1400 })];
  const position = buildPositionFromTradeRows(rows);
  assert.equal(position.krwCost, 0);
  assert.equal(position.hasExactKrwCost, false);
  assert.equal(position.quantity, 10);
});

test('회차가 다르면 원금도 따로 잡힌다', () => {
  const ledger = [
    usd({ id: 'a', round: 1, side: 'buy', date: '2025-01-10', quantity: 10, price: 30, fxRate: 1450 }),
    usd({ id: 'b', round: 1, side: 'sell', date: '2025-03-10', quantity: 10, price: 35, fxRate: 1430 }),
    usd({ id: 'c', round: 2, side: 'buy', date: '2025-05-10', quantity: 20, price: 20, fxRate: 1360 }),
  ];
  const basis = buildKrwCostBasisByAsset(ledger, rateOf);

  const round2 = basis.get(getTradeAssetKey(usd({ round: 2 })));
  assert.equal(round2.krwCost, 20 * 20 * 1360); // 544,000 — 1차 물량이 섞이지 않는다
  const round1 = basis.get(getTradeAssetKey(usd({ round: 1 })));
  assert.equal(round1.krwCost, 0); // 전량 매도되어 남은 원금 없음
});

test('토스 SOXL 사례 재현: 원금 차이가 사라진다', () => {
  // 매수 시점 평균 환율이 오늘보다 높았던 상황
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-01-15', quantity: 30, price: 20, fxRate: 1465 }),
    usd({ id: 'b', side: 'buy', date: '2025-03-20', quantity: 20, price: 21.5, fxRate: 1450 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });
  const todayRate = 1320;
  const oldWay = (30 * 20 + 20 * 21.5) * todayRate;

  assert.equal(Math.round(position.krwCost), 30 * 20 * 1465 + 20 * 21.5 * 1450);
  assert.ok(position.krwCost - oldWay > 100000); // 십만 원 단위 차이가 실제로 발생
});

test('원장 전체에서 매도 행의 krwPnl이 유지된다', () => {
  const ledger = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 100, price: 20, fxRate: 1400 }),
    usd({ id: 'b', side: 'sell', date: '2025-06-10', quantity: 50, price: 30, fxRate: 1350 }),
  ];
  const canonical = buildCanonicalTradeRows({ tradeLedger: ledger, resolveKrwRate: rateOf });
  const sell = canonical.find((row) => row.side === 'sell');
  assert.equal(sell.krwPnl, 50 * (30 - 20) * 1400);
});

test('보유 중인 원금은 오늘 환율이 아무리 움직여도 그대로다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 50, price: 30, fxRate: 1465 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });

  // 표시 환율 = 원금 ÷ 달러 매입액. 오늘 환율이 무엇이든 이 값은 바뀌지 않는다.
  const displayRate = position.krwCost / (50 * 30);
  assert.equal(displayRate, 1465);

  // 주가만 오른 경우: 평가금액도 같은 환율로 환산되어 환차익이 0이다.
  const currentPriceUsd = 33;
  const currentKRW = currentPriceUsd * 50 * displayRate;
  const profitKRW = currentKRW - position.krwCost;
  assert.equal(profitKRW, (33 - 30) * 50 * 1465);
  assert.equal(profitKRW / position.krwCost, (33 - 30) / 30); // 원화 수익률 = 달러 수익률
});

test('환율을 모르는 매수분이 섞이면 부분 매도해도 원금이 "정확"해지지 않는다', () => {
  // 10주는 환율(1300)을 알고, 10주는 모른다. 15주를 팔면 이동평균상 남은 5주에도
  // 환율 미상분이 비례해서 남아 있어야 한다. 매도 수량만큼 통째로 빼면
  // 미상분이 0이 되면서 원금이 절반으로 과소 계상된 채 "정확"으로 표시됐다.
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-01-10', quantity: 10, price: 100, fxRate: 1300 }),
    usd({ id: 'b', side: 'buy', date: '2025-02-10', quantity: 10, price: 100 }),
    usd({ id: 'c', side: 'sell', date: '2025-03-10', quantity: 15, price: 100 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });

  assert.equal(position.quantity, 5);
  assert.equal(position.hasExactKrwCost, false);

  const sellRow = position.rows.find((row) => row.id === 'c');
  assert.equal(sellRow.krwPnl, null);
});

test('환율을 모두 아는 포지션은 부분 매도 후에도 원금이 정확하다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-01-10', quantity: 10, price: 100, fxRate: 1300 }),
    usd({ id: 'b', side: 'buy', date: '2025-02-10', quantity: 10, price: 100, fxRate: 1400 }),
    usd({ id: 'c', side: 'sell', date: '2025-03-10', quantity: 15, price: 100 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });

  assert.equal(position.quantity, 5);
  assert.equal(position.hasExactKrwCost, true);
  assert.equal(position.krwCost, 5 * 100 * 1350);
});
