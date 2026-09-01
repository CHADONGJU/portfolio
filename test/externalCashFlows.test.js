import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTransactionSourceIdentity,
  createSourceHash,
  dedupeCapitalFlowsForPerformance,
  mergeCapitalFlows,
  resolveExternalCashFlowKrw,
  toCapitalFlowRecord,
} from '../src/utils/externalCashFlows.js';

const base = {
  broker: 'KB_SECURITIES',
  accountId: 'account-hash',
  transactionDate: '2026-09-01',
  transactionTime: '12:34:56',
  rawType: '외화연계입금',
  normalizedType: 'DEPOSIT',
  amount: 1000,
  currency: 'USD',
  bankName: '국민은행',
  recipientName: 'ChanhoSong',
  sourceHash: 'source-hash',
};

test('source identity는 실제 PDF 컬럼만 사용한다', () => {
  assert.equal(
    buildTransactionSourceIdentity(base),
    'KB_SECURITIES|account-hash|2026-09-01|12:34:56|외화연계입금|1000|USD|국민은행|ChanhoSong',
  );
});

test('같은 거래는 같은 SHA-256 source hash를 만든다', async () => {
  assert.equal(await createSourceHash(base), await createSourceHash({ ...base }));
});

test('KRW 입금과 출금은 환율 조회 없이 그대로 환산한다', async () => {
  let calls = 0;
  const resolveFx = async () => {
    calls += 1;
    return null;
  };
  const deposit = await resolveExternalCashFlowKrw({
    ...base, currency: 'KRW', amount: 10000000,
  }, resolveFx);
  const withdrawal = await resolveExternalCashFlowKrw({
    ...base, normalizedType: 'WITHDRAWAL', currency: 'KRW', amount: 500000,
  }, resolveFx);

  assert.equal(deposit.amountKRW, 10000000);
  assert.equal(withdrawal.amountKRW, 500000);
  assert.equal(calls, 0);
});

test('USD 입출금은 거래일 환율과 원본 금액을 함께 보존한다', async () => {
  const resolveFx = async () => ({
    rate: 1350.25,
    rateDate: '2026-09-01',
    source: 'FRANKFURTER_ECB',
  });
  const deposit = await resolveExternalCashFlowKrw(base, resolveFx);
  const withdrawal = await resolveExternalCashFlowKrw({
    ...base, normalizedType: 'WITHDRAWAL', amount: 500,
  }, resolveFx);

  assert.equal(deposit.amount, 1000);
  assert.equal(deposit.amountKRW, 1350250);
  assert.equal(withdrawal.amountKRW, 675125);
  assert.equal(deposit.fxRateDate, '2026-09-01');
});

test('내부 환전은 External Cash Flow를 만들지 않는다', async () => {
  const internal = await resolveExternalCashFlowKrw({
    ...base, normalizedType: 'INTERNAL', rawType: '외화매수',
  }, async () => ({ rate: 1350 }));
  assert.equal(internal.fxStatus, 'NOT_REQUIRED');
  assert.equal(toCapitalFlowRecord(internal), null);
});

test('환율 실패는 FX_RATE_MISSING으로 저장 가능하지만 임의 KRW 금액은 만들지 않는다', async () => {
  const unresolved = await resolveExternalCashFlowKrw(base, async () => null);
  const record = toCapitalFlowRecord(unresolved, '2026-09-02T00:00:00.000Z');
  assert.equal(unresolved.fxStatus, 'FX_RATE_MISSING');
  assert.equal(record.amount, 1000);
  assert.equal(record.currency, 'USD');
  assert.equal(record.amountKRW, null);
});

test('동일 PDF를 다시 반영해도 source hash 기준으로 중복 저장하지 않는다', () => {
  const first = toCapitalFlowRecord({ ...base, amountKRW: 1350000, fxRate: 1350, fxStatus: 'READY' });
  const result = mergeCapitalFlows([first], [{ ...first }]);
  assert.equal(result.length, 1);
});

test('수동 입력 후 같은 PDF 거래를 반영하면 DB는 보존하고 TWR 입력만 한 건으로 만든다', () => {
  const manual = {
    id: 'capital-flow-legacy',
    date: '2026-07-14',
    type: 'deposit',
    amount: 3000,
    currency: 'USD',
    amountKRW: 4514700,
  };
  const pdf = toCapitalFlowRecord({
    ...base,
    transactionDate: '2026-07-14',
    amount: 3000,
    amountKRW: 4476569.62191,
    fxRate: 1492.18987397,
    fxStatus: 'READY',
  });
  const stored = [manual, pdf];
  const performanceFlows = dedupeCapitalFlowsForPerformance(stored);

  assert.equal(stored.length, 2);
  assert.equal(performanceFlows.length, 1);
  assert.equal(performanceFlows[0].sourceType, 'BROKER_PDF');
  assert.equal(performanceFlows[0].amountKRW, 4476569.62191);
});

test('동일 금액의 서로 다른 PDF 거래는 source hash가 다르면 모두 유지한다', () => {
  const first = toCapitalFlowRecord({
    ...base,
    sourceHash: 'first',
    amountKRW: 1350000,
    fxRate: 1350,
    fxStatus: 'READY',
  });
  const second = toCapitalFlowRecord({
    ...base,
    sourceHash: 'second',
    transactionTime: '13:34:56',
    amountKRW: 1350000,
    fxRate: 1350,
    fxStatus: 'READY',
  });

  assert.equal(dedupeCapitalFlowsForPerformance([first, second]).length, 2);
});
