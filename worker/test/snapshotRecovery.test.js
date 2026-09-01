import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSnapshotRecoveryDates,
  canRecoverHistoricalValuation,
  createVerifiedHistoricalSnapshot,
} from '../src/snapshotRecovery.js';

test('누락일 복원은 오래된 날짜를 조금씩 처리하면서 전날은 항상 포함한다', () => {
  assert.deepEqual(buildSnapshotRecoveryDates({
    joinedAt: '2026-08-20',
    targetDate: '2026-08-28',
    existingDates: ['2026-08-20'],
    maxDates: 3,
  }), ['2026-08-21', '2026-08-22', '2026-08-28']);
});

test('실제 보유 현금·주식에 필요한 과거 현금 잔액·종가가 없으면 복원 가능하다고 꾸미지 않는다', () => {
  const result = canRecoverHistoricalValuation({
    assets: [
      { category: '현금', quantity: 1000 },
      { category: '해외주식', ticker: 'AAPL', quantity: 1 },
    ],
    historicalQuotes: [],
    eventCounts: { trades: 1, cashMovements: 1 },
  });
  assert.equal(result.recoverable, false);
  assert.equal(result.reasons.includes('historical-cash-balance-missing'), true);
  assert.equal(result.reasons.includes('historical-close-missing'), true);
  assert.equal(result.reasons.includes('trade-ledger-incomplete'), true);
});

test('과거 복원 날짜는 PDF로 확인한 계좌 개시일까지 재시도할 수 있다', () => {
  assert.deepEqual(buildSnapshotRecoveryDates({
    accountInceptionDate: '2026-08-20',
    twrAvailableFrom: '2026-08-26',
    serviceJoinedAt: '2026-08-26',
    targetDate: '2026-08-28',
    existingDates: ['2026-08-26', '2026-08-27'],
    maxDates: 3,
  }), ['2026-08-20', '2026-08-21', '2026-08-28']);
});

test('모든 replay 자료와 평가액 검증이 끝난 날짜만 Historical Snapshot을 만든다', () => {
  const coverage = {
    externalCashFlowsComplete: true,
    tradeLedgerComplete: true,
    cashLedgerComplete: true,
    fxLedgerComplete: true,
    dividendsComplete: true,
    feesAndTaxesComplete: true,
    corporateActionsComplete: true,
    historicalPricesComplete: true,
    historicalFxComplete: true,
    settlementDataComplete: true,
  };
  const result = createVerifiedHistoricalSnapshot({
    date: '2025-01-15',
    assets: [{ category: '해외주식', ticker: 'AAPL', quantity: 1 }],
    historicalQuotes: [{ ticker: 'AAPL', price: 200 }],
    coverage,
    eventCounts: { trades: 1 },
    valuation: {
      status: 'complete', valueKRW: 300000, missingAssets: [], missingCurrencies: [],
    },
    generatedAt: '2026-08-28T00:00:00.000Z',
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.snapshot.source, 'historical-reconstruction');
  assert.equal(result.snapshot.validationStatus, 'verified');
  assert.equal(result.snapshot.includesCash, true);
});

test('실제 현금 이동이 있었는데 현금 원장 검증이 빠지면 Historical Snapshot을 만들지 않는다', () => {
  const result = createVerifiedHistoricalSnapshot({
    date: '2025-01-15',
    valuation: { status: 'complete', valueKRW: 300000, missingAssets: [], missingCurrencies: [] },
    coverage: { historicalPricesComplete: true },
    eventCounts: { cashMovements: 1 },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.snapshot, null);
  assert.equal(result.reasons.includes('cash-ledger-incomplete'), true);
});

test('발생하지 않은 배당·환전·Corporate Action은 0건을 정상으로 인정한다', () => {
  const result = createVerifiedHistoricalSnapshot({
    date: '2025-01-15',
    assets: [{ category: '국내주식', ticker: '005930', quantity: 1, currency: 'KRW' }],
    historicalQuotes: [{ ticker: '005930', price: 60000 }],
    valuation: { status: 'complete', valueKRW: 60000, missingAssets: [], missingCurrencies: [] },
    coverage: {
      tradeLedgerComplete: true,
      cashLedgerComplete: true,
      historicalPricesComplete: true,
    },
    eventCounts: {
      trades: 1,
      dividends: 0,
      fxTransactions: 0,
      corporateActions: 0,
      feesAndTaxes: 0,
      settlements: 0,
      externalCashFlows: 0,
      cashMovements: 0,
    },
  });

  assert.equal(result.status, 'verified');
  assert.deepEqual(result.reasons, []);
});
