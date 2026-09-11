import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTradeRecordEditPatch,
  countUnmatchedSells,
  getEditableTradeFields,
  toLegacySellTradePatch,
  validateTradeRecordEdit,
} from '../src/utils/tradeRecordEditing.js';
import { isRemovedAssetCategory } from '../src/constants.js';

test('옛 매도 기록은 평단(buyPrice)이 아니라 매도일·매도가를 편집 값으로 쓴다', () => {
  const legacyTrade = {
    name: '삼성전자', quantity: 10, buyDate: '2026-01-02', buyPrice: 50000,
    sellDate: '2026-03-02', sellPrice: 60000, pnl: 100000,
  };

  assert.deepEqual(getEditableTradeFields(legacyTrade), { side: 'sell', date: '2026-03-02', price: 60000, brokerFee: 0 });
  assert.deepEqual(
    getEditableTradeFields({ side: 'buy', date: '2026-01-02', price: 50000, brokerFee: 7 }),
    { side: 'buy', date: '2026-01-02', price: 50000, brokerFee: 7 },
  );
});

test('거래일과 단가가 올바르지 않으면 저장하지 않는다', () => {
  assert.equal(validateTradeRecordEdit({ date: '2026-02-30', price: 100 }), '거래일을 올바르게 입력해주세요.');
  assert.equal(validateTradeRecordEdit({ date: '', price: 100 }), '거래일을 올바르게 입력해주세요.');
  assert.equal(validateTradeRecordEdit({ date: '2026-02-28', price: 0 }), '단가를 올바르게 입력해주세요.');
  assert.equal(validateTradeRecordEdit({ date: '2026-02-28', price: '1,200' }), null);
  assert.equal(validateTradeRecordEdit({ date: '2026-02-28', price: 1200, brokerFee: -1 }), '수수료를 올바르게 입력해주세요.');
  assert.equal(validateTradeRecordEdit({ date: '2026-02-28', price: 1200, brokerFee: '' }), null);
});

test('매수가를 고치면 수수료 금액은 그대로 두고 요율만 다시 역산한다', () => {
  const patch = buildTradeRecordEditPatch(
    { side: 'buy', currency: 'KRW', quantity: 10, price: 10000, brokerFee: 15, brokerFeeRatePercent: 0.015 },
    { date: '2026-05-01', price: 20000 },
  );

  assert.equal(patch.date, '2026-05-01');
  assert.equal(patch.price, 20000);
  assert.equal(patch.brokerFee, 15);
  assert.equal(patch.brokerFeeRatePercent, 0.0075);
  assert.equal(patch.pnl, undefined);
});

test('매수 수수료를 고치면 그 금액을 원 단위로 절사해 남기고 요율을 다시 역산한다', () => {
  const patch = buildTradeRecordEditPatch(
    { side: 'buy', currency: 'KRW', quantity: 10, price: 10000, brokerFee: 15 },
    { date: '2026-05-01', price: 10000, brokerFee: '20.9' },
  );

  assert.equal(patch.brokerFee, 20);
  assert.equal(patch.brokerFeeRatePercent, 0.02);
});

test('매도 수수료를 고치면 늘어난 수수료만큼 실현 손익이 줄어든다', () => {
  const sell = {
    side: 'sell', currency: 'USD', quantity: 5, price: 100,
    brokerFee: 1.25, grossPnl: 50, pnl: 48.75,
  };

  const patch = buildTradeRecordEditPatch(sell, { date: '2026-03-02', price: 100, brokerFee: 2.5 });

  assert.equal(patch.brokerFee, 2.5);
  assert.equal(patch.grossPnl, 50);
  assert.equal(patch.pnl, 47.5);
});

test('매도가를 고치면 기록된 손익을 단가 차이만큼 옮기고 제세금을 새 매도금액으로 다시 잡는다', () => {
  const sell = {
    side: 'sell', currency: 'KRW', quantity: 10, price: 60000,
    brokerFee: 90, sellTaxRatePercent: 0.2, sellTax: 1200,
    grossPnl: 100000, pnl: 98710,
  };

  const patch = buildTradeRecordEditPatch(sell, { date: '2026-03-02', price: 61000 });

  assert.equal(patch.sellTax, 1220);
  assert.equal(patch.grossPnl, 110000);
  // +10,000(단가 차이) - 20(늘어난 제세금). 매수 수수료 반영분 같은 나머지는 건드리지 않는다.
  assert.equal(patch.pnl, 108690);
});

test('손익을 비워 둔 누락 매도 기록에는 없던 손익을 만들지 않는다', () => {
  const patch = buildTradeRecordEditPatch(
    { side: 'sell', currency: 'USD', quantity: 2, price: 100, pnl: 0, grossPnl: 0 },
    { date: '2026-03-02', price: 110, fxRate: 1380 },
  );

  assert.equal(patch.pnl, undefined);
  assert.equal(patch.grossPnl, undefined);
  assert.equal(patch.fxRate, 1380);
});

test('옛 매도 기록에는 sellDate/sellPrice로 옮겨 적는다', () => {
  assert.deepEqual(
    toLegacySellTradePatch({ date: '2026-03-02', price: 61000, pnl: 1 }),
    { sellDate: '2026-03-02', sellPrice: 61000, pnl: 1 },
  );
});

test('매수일을 매도일 뒤로 옮기면 매칭되지 않는 매도가 생긴다', () => {
  const buy = { id: 'b', name: 'A', side: 'buy', date: '2026-01-02', quantity: 10, price: 100 };
  const sell = { id: 's', name: 'A', side: 'sell', date: '2026-02-02', quantity: 10, price: 120, pnl: 200 };

  assert.equal(countUnmatchedSells([buy, sell]), 0);
  assert.equal(countUnmatchedSells([{ ...buy, date: '2026-03-02' }, sell]), 1);
});

test('없앤 현금·원자재 분류만 걸러내고 분류가 빈 옛 기록은 남긴다', () => {
  assert.equal(isRemovedAssetCategory('현금'), true);
  assert.equal(isRemovedAssetCategory(' 원자재 '), true);
  assert.equal(isRemovedAssetCategory('국내주식'), false);
  assert.equal(isRemovedAssetCategory(''), false);
});
