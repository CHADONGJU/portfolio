import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalTradeRows,
  buildKrwCostBasisByAsset,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  reconcileAssetsWithTradeLedger,
  scaleManualPurchaseKRW,
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

test('해외 소수점 복수 매수 평단은 달러 기준 수량가중 평균이다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2026-07-07', quantity: 2, price: 134.69, fxRate: 1378 }),
    usd({ id: 'b', side: 'buy', date: '2026-07-17', quantity: 0.477, price: 134.67, fxRate: 1386 }),
    usd({ id: 'c', side: 'buy', date: '2026-07-21', quantity: 4.004914, price: 160.66, fxRate: 1410 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });
  const totalQuantity = 2 + 0.477 + 4.004914;
  const totalCost = 2 * 134.69 + 0.477 * 134.67 + 4.004914 * 160.66;

  assert.equal(position.quantity, totalQuantity);
  assert.equal(position.averagePrice, totalCost / totalQuantity);
  assert.equal(position.hasExactKrwCost, true);
  assert.equal(position.krwCost, 2 * 134.69 * 1378 + 0.477 * 134.67 * 1386 + 4.004914 * 160.66 * 1410);
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

test('보유 중인 원금과 원화 평단은 오늘 환율이 아무리 움직여도 그대로다', () => {
  const rows = [
    usd({ id: 'a', side: 'buy', date: '2025-02-10', quantity: 50, price: 30, fxRate: 1465 }),
  ];
  const position = buildPositionFromTradeRows(rows, { resolveKrwRate: rateOf });

  assert.equal(position.krwCost, 50 * 30 * 1465);
  assert.equal(position.krwCost / position.quantity, 30 * 1465);
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

test('일부 매도하면 확정 원금도 남은 수량 비율로 줄인다', () => {
  assert.equal(scaleManualPurchaseKRW(1000000, 10, 4), 400000);
  assert.equal(scaleManualPurchaseKRW(1000000, 10, 10), 1000000);
  // 전량 매도하면 남길 원금이 없다.
  assert.equal(scaleManualPurchaseKRW(1000000, 10, 0), null);
  // 애초에 확정 원금이 없으면 만들어내지 않는다.
  assert.equal(scaleManualPurchaseKRW(null, 10, 4), null);
  assert.equal(scaleManualPurchaseKRW(0, 10, 4), null);
});

test('원장 정합으로 수량이 줄면 확정 원금도 함께 줄어든다', () => {
  const assets = [{
    id: 1,
    name: 'NVDA',
    ticker: 'NVDA',
    category: '해외주식',
    currency: 'USD',
    quantity: 10,
    averagePrice: 100,
    originalAveragePrice: 100,
    manualPurchaseKRW: 1400000,
    buyDate: '2026-01-05',
  }];
  const ledger = [
    { id: 'b1', name: 'NVDA', ticker: 'NVDA', category: '해외주식', currency: 'USD', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, fxRate: 1400 },
    { id: 's1', name: 'NVDA', ticker: 'NVDA', category: '해외주식', currency: 'USD', side: 'sell', date: '2026-06-01', quantity: 6, price: 150, fxRate: 1350 },
  ];

  const [reconciled] = reconcileAssetsWithTradeLedger(assets, ledger);

  assert.equal(reconciled.quantity, 4);
  assert.equal(reconciled.originalAveragePrice, 100);
  assert.equal(reconciled.manualPurchaseKRW, 560000);
});

test('전량 매도 시 환율 미상 물량이 섞여 있으면 원화 취득원가를 넘기지 않는다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100 }),
    usd({ id: 'b2', side: 'buy', date: '2026-02-05', quantity: 10, price: 100, fxRate: 1400 }),
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 20, price: 200, fxRate: 1350 }),
  ], { resolveKrwRate: rateOf });

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.krwPnl, null);
  // 절반의 환율만 알아 1,400,000원만 쌓였다. 그대로 넘기면 양도차익이 부풀려진다.
  assert.equal(sell.krwCostRemoved, null);
  assert.equal(sell.nativeCostRemoved, 2000);
});

test('환율을 모두 알면 원화 취득원가를 그대로 넘긴다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, fxRate: 1300 }),
    usd({ id: 'b2', side: 'buy', date: '2026-02-05', quantity: 10, price: 100, fxRate: 1400 }),
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 10, price: 200, fxRate: 1350 }),
  ], { resolveKrwRate: rateOf });

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.krwCostRemoved, 1350000);
  assert.equal(sell.nativeCostRemoved, 1000);
});

test('이전 수량을 알 수 없으면 확정 원금을 지우지 않는다', () => {
  assert.equal(scaleManualPurchaseKRW(1000000, 0, 4), 1000000);
  assert.equal(scaleManualPurchaseKRW(1000000, '', 4), 1000000);
});

test('매수 수수료는 평단가를 건드리지 않고 판 수량만큼만 손익에서 빠진다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, brokerFee: 2.5, fxRate: 1300 }),
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 4, price: 150, brokerFee: 1.5, fxRate: 1400 }),
  ], { resolveKrwRate: rateOf });

  // 평단가는 증권사 화면과 같게 수수료를 빼고 계산한다.
  assert.equal(position.averagePrice, 100);
  // 남은 6주에 붙어 있는 매수 수수료.
  assert.equal(position.buyFeeCost, 1.5);

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.grossPnl, 200);
  // 200 - 매도수수료 1.5 - 배분된 매수수수료 1(=2.5×4/10)
  assert.equal(sell.pnl, 197.5);
  assert.equal(sell.buyFeeRemoved, 1);
  assert.equal(sell.krwBuyFeeRemoved, 1300);
  // 원화 실현손익도 매수일 환율 기준: (150×4 - 100×4 - 1.5)×1300 - 1300
  assert.equal(Math.round(sell.krwPnl), Math.round((200 - 1.5) * 1300 - 1300));
});

test('전량 매도하면 매수 수수료가 남지 않는다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, brokerFee: 2.5, fxRate: 1300 }),
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 10, price: 150, fxRate: 1400 }),
  ], { resolveKrwRate: rateOf });

  assert.equal(position.buyFeeCost, 0);
  assert.equal(position.krwBuyFeeCost, 0);
  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.buyFeeRemoved, 2.5);
  assert.equal(sell.pnl, 497.5);
});

test('기록된 실현손익이 있으면 매수 수수료를 두 번 빼지 않는다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, brokerFee: 2.5 }),
    // 앱이 매도할 때 이미 매수 수수료를 반영해 기록한 값.
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 10, price: 150, pnl: 497.5, buyFeeApplied: 2.5 }),
  ]);

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.pnl, 497.5);
});

test('기록된 매수 수수료 반영분이 있으면 재계산값보다 그것을 우선한다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, brokerFee: 5, fxRate: 1300 }),
    // 매도 당시에는 매수 수수료가 2.5였고 손익도 그 기준으로 기록됐다.
    // 이후 매수 기록을 고쳐 수수료가 5로 바뀌어도, 기록된 손익과 세금 필요경비는 어긋나면 안 된다.
    usd({
      id: 's1', side: 'sell', date: '2026-06-01', quantity: 5, price: 150,
      pnl: 247.5, buyFeeApplied: 2.5, fxRate: 1400,
    }),
  ], { resolveKrwRate: rateOf });

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.pnl, 247.5);
  assert.equal(sell.buyFeeRemoved, 2.5);
  assert.equal(sell.krwBuyFeeRemoved, 2.5 * 1300);
  // 남은 보유분에서는 비례 배분값(5 × 5/10 = 2.5)을 덜어내 총액이 어긋나지 않게 한다.
  assert.equal(position.buyFeeCost, 2.5);
});

test('매수 수수료 원화 환산은 수수료를 낸 시점 환율 구성을 지킨다', () => {
  // 수수료는 환율 1,000원일 때만 냈고, 두 번째 매수는 환율 2,000원에 수수료가 없다.
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, brokerFee: 10, fxRate: 1000 }),
    usd({ id: 'b2', side: 'buy', date: '2026-02-05', quantity: 10, price: 100, fxRate: 2000 }),
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 10, price: 150, buyFeeApplied: 5, fxRate: 2100 }),
  ], { resolveKrwRate: rateOf });

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.buyFeeRemoved, 5);
  // 매수금액 가중평균 환율(1,500원)이 아니라 수수료를 실제로 낸 1,000원이어야 한다.
  assert.equal(sell.krwBuyFeeRemoved, 5000);
});

test('매도 행에 매수 수수료 기록이 아예 없으면 비례 배분값을 쓴다', () => {
  const position = buildPositionFromTradeRows([
    usd({ id: 'b1', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, brokerFee: 10, fxRate: 1300 }),
    // buyFeeApplied 키 자체가 없는 옛 기록(또는 수기 매도).
    usd({ id: 's1', side: 'sell', date: '2026-06-01', quantity: 5, price: 150, fxRate: 1400 }),
  ], { resolveKrwRate: rateOf });

  const sell = position.rows.find((row) => row.side === 'sell');
  assert.equal(sell.buyFeeRemoved, 5);
  assert.equal(sell.krwBuyFeeRemoved, 6500);
  assert.equal(position.buyFeeCost, 5);
});
