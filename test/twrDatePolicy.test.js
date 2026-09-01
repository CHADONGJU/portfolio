import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeInitialPortfolioSnapshot,
  deriveTwrDatePolicy,
  ensureInitialPortfolioSnapshot,
  isInitialSnapshotValuationReady,
  mergeVerifiedHistoricalSnapshots,
} from '../src/utils/twrDatePolicy.js';

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const dailySnapshots = (startDay, endDay, source = 'cloudflare-cron') => {
  const rows = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    rows.push({
      id: `snapshot-${date}`,
      date,
      valueKRW: 1000 + day,
      includesCash: true,
      status: 'complete',
      source,
      valuationBasis: 'eod',
      valuationTimestamp: `${shiftDate(date, 1)}T07:10:00+09:00`,
      valuationValidation: 'confirmed',
      generatedAt: `${shiftDate(date, 1)}T07:10:00+09:00`,
    });
  }
  return rows;
};

const verifiedHistoricalSnapshot = (snapshot) => ({
  includesCash: true,
  status: 'complete',
  source: 'historical-reconstruction',
  validationStatus: 'verified',
  valuationValidation: 'confirmed',
  valuationBasis: 'eod',
  valuationTimestamp: `${snapshot.date}T23:59:59.999+09:00`,
  ...snapshot,
});

test('A. 과거자료가 없으면 초기 설정 완료로 잠근 Snapshot부터 TWR이 가능하다', () => {
  const initializing = ensureInitialPortfolioSnapshot({
    snapshots: [],
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 10000000,
    unrealizedProfitKRW: 500000,
    valuationReady: true,
    generatedAt: '2026-08-26T01:00:00.000Z',
  });
  const snapshots = completeInitialPortfolioSnapshot({
    snapshots: initializing,
    snapshotDate: '2026-08-26',
    completedAt: '2026-08-26T01:05:00.000Z',
  });
  const policy = deriveTwrDatePolicy({
    serviceJoinedAt: '2026-08-26',
    snapshots,
  });

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].source, 'initial');
  assert.equal(snapshots[0].status, 'complete');
  assert.equal(snapshots[0].lockedAt, '2026-08-26T01:05:00.000Z');
  assert.equal(snapshots[0].includesCash, true);
  assert.equal(policy.serviceJoinedAt, '2026-08-26');
  assert.equal(policy.twrAvailableFrom, '2026-08-26');
});

test('초기 Snapshot은 모든 시장자산 시세가 실제 조회된 뒤에만 준비된다', () => {
  assert.equal(isInitialSnapshotValuationReady({
    assets: [{ category: '해외주식', currentPrice: 100, currentKRW: 135000, quoteStatus: 'cached' }],
    totalValueKRW: 135000,
  }), false);
  assert.equal(isInitialSnapshotValuationReady({
    assets: [{ category: '해외주식', currentPrice: 100, currentKRW: 135000, quoteStatus: 'live' }],
    totalValueKRW: 135000,
  }), true);
});

test('B. 과거 입출금 PDF만으로는 TWR 시작일이 과거로 이동하지 않는다', () => {
  const policy = deriveTwrDatePolicy({
    serviceJoinedAt: '2026-08-26',
    capitalFlows: [
      { date: '2025-01-10', type: 'deposit', amountKRW: 10000000, sourceType: 'BROKER_PDF' },
      { date: '2025-06-20', type: 'deposit', amountKRW: 1000000, sourceType: 'BROKER_PDF' },
      { date: '2026-03-10', type: 'withdrawal', amountKRW: 500000, sourceType: 'BROKER_PDF' },
    ],
    snapshots: dailySnapshots(26, 28),
  });

  assert.equal(policy.accountInceptionDate, '2025-01-10');
  assert.equal(policy.serviceJoinedAt, '2026-08-26');
  assert.equal(policy.twrAvailableFrom, '2026-08-26');
});

test('C. 전체 과거 원장 replay 검증 Snapshot만 계좌 개시일까지 확장한다', () => {
  const historical = [
    { date: '2026-08-23', valueKRW: 900, includesCash: true, status: 'complete', source: 'historical-reconstruction', validationStatus: 'verified' },
    { date: '2026-08-24', valueKRW: 950, includesCash: true, status: 'complete', source: 'historical-reconstruction', validationStatus: 'verified' },
    { date: '2026-08-25', valueKRW: 975, includesCash: true, status: 'complete', source: 'historical-reconstruction', validationStatus: 'verified' },
  ].map(verifiedHistoricalSnapshot);
  const snapshots = mergeVerifiedHistoricalSnapshots(dailySnapshots(26, 28), historical);
  const policy = deriveTwrDatePolicy({
    serviceJoinedAt: '2026-08-26',
    capitalFlows: [{ date: '2026-08-23', type: 'deposit', amountKRW: 900 }],
    snapshots,
  });

  assert.equal(snapshots.length, 6);
  assert.equal(policy.accountInceptionDate, '2026-08-23');
  assert.equal(policy.twrAvailableFrom, '2026-08-23');
});

test('D. 일부만 검증되면 연속 복원 가능한 최초 날짜까지만 확장한다', () => {
  const historical = [
    { date: '2026-08-20', valueKRW: 800, includesCash: true, status: 'complete', source: 'historical-reconstruction', validationStatus: 'verified' },
    { date: '2026-08-24', valueKRW: 950, includesCash: true, status: 'complete', source: 'historical-reconstruction', validationStatus: 'verified' },
    { date: '2026-08-25', valueKRW: 975, includesCash: true, status: 'complete', source: 'historical-reconstruction', validationStatus: 'verified' },
  ].map(verifiedHistoricalSnapshot);
  const snapshots = mergeVerifiedHistoricalSnapshots(dailySnapshots(26, 28), historical);
  const policy = deriveTwrDatePolicy({
    serviceJoinedAt: '2026-08-26',
    capitalFlows: [{ date: '2026-08-20', type: 'deposit', amountKRW: 800 }],
    snapshots,
  });

  assert.equal(policy.accountInceptionDate, '2026-08-20');
  assert.equal(policy.twrAvailableFrom, '2026-08-24');
});

test('검증 표시나 현금 포함이 없는 과거 Snapshot은 저장하지 않는다', () => {
  const result = mergeVerifiedHistoricalSnapshots([], [
    { date: '2025-01-10', valueKRW: 10000000, source: 'historical-reconstruction', status: 'complete' },
    { date: '2025-01-11', valueKRW: 10100000, source: 'historical-reconstruction', status: 'complete', validationStatus: 'verified' },
  ]);
  assert.deepEqual(result, []);
});

test('F. Initial/Historical Snapshot 병합은 같은 날짜에 중복 생성하지 않는다', () => {
  const initial = ensureInitialPortfolioSnapshot({
    snapshots: [],
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 1000,
    valuationReady: true,
  });
  const repeatedInitial = ensureInitialPortfolioSnapshot({
    snapshots: initial,
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 1000,
    valuationReady: true,
  });
  const completedInitial = completeInitialPortfolioSnapshot({
    snapshots: repeatedInitial,
    snapshotDate: '2026-08-26',
    completedAt: '2026-08-26T01:00:00.000Z',
  });
  const merged = mergeVerifiedHistoricalSnapshots(completedInitial, [verifiedHistoricalSnapshot({
    date: '2026-08-26', valueKRW: 999, includesCash: true, status: 'complete',
    source: 'historical-reconstruction', validationStatus: 'verified',
  })]);

  assert.equal(repeatedInitial, initial);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'initial');
});

test('최초 설정 당일 자산이 추가되면 같은 Initial Snapshot을 최신 전체 평가액으로 갱신한다', () => {
  const initial = ensureInitialPortfolioSnapshot({
    snapshots: [],
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 1000,
    valuationReady: true,
    generatedAt: '2026-08-26T01:00:00.000Z',
  });
  const updated = ensureInitialPortfolioSnapshot({
    snapshots: initial,
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 2500,
    valuationReady: true,
    generatedAt: '2026-08-26T01:10:00.000Z',
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].valueKRW, 2500);
  assert.equal(updated[0].generatedAt, '2026-08-26T01:10:00.000Z');
  assert.equal(updated[0].status, 'initializing');
});

test('Initial Snapshot은 COMPLETE 확정 뒤 같은 날짜 평가액으로 덮어쓰지 않는다', () => {
  const initializing = ensureInitialPortfolioSnapshot({
    snapshots: [],
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 1000,
    valuationReady: true,
  });
  const completed = completeInitialPortfolioSnapshot({
    snapshots: initializing,
    snapshotDate: '2026-08-26',
    completedAt: '2026-08-26T01:00:00.000Z',
  });
  const attemptedOverwrite = ensureInitialPortfolioSnapshot({
    snapshots: completed,
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 2500,
    valuationReady: true,
  });

  assert.equal(attemptedOverwrite, completed);
  assert.equal(attemptedOverwrite[0].valueKRW, 1000);
  assert.equal(attemptedOverwrite[0].status, 'complete');
});

test('INITIALIZING Snapshot은 TWR 시작 기준으로 인정하지 않는다', () => {
  const initializing = ensureInitialPortfolioSnapshot({
    snapshots: [],
    serviceJoinedAt: '2026-08-26',
    snapshotDate: '2026-08-26',
    valueKRW: 1000,
    valuationReady: true,
  });
  const policy = deriveTwrDatePolicy({
    snapshots: initializing,
    serviceJoinedAt: '2026-08-26',
  });

  assert.equal(policy.twrAvailableFrom, '');
});

test('상태와 valuation metadata가 없는 client auto Snapshot은 TWR 기준으로 인정하지 않는다', () => {
  const policy = deriveTwrDatePolicy({
    snapshots: [
      { date: '2026-08-24', valueKRW: 1000, source: 'auto' },
      { date: '2026-08-25', valueKRW: 1100, source: 'auto' },
    ],
    serviceJoinedAt: '2026-08-24',
  });

  assert.equal(policy.twrAvailableFrom, '');
});
