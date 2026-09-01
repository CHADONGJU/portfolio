import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAvailableDailyTwr as calculateAvailableDailyTwrRaw,
  calculateAnnualDailyTwr as calculateAnnualDailyTwrRaw,
  calculateDailyTwr as calculateDailyTwrRaw,
  getAnnualTwrYears,
} from '../src/utils/timeWeightedReturn.js';

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const formalizeSnapshots = (snapshots = []) => snapshots.map((snapshot) => {
  if (snapshot.source === 'auto' || snapshot.source === 'live' || snapshot.status === 'provisional') {
    return snapshot;
  }
  if (snapshot.valuationBasis === 'setup-complete') {
    return {
      ...snapshot,
      source: 'initial',
      status: 'complete',
      includesCash: true,
      valuationValidation: 'confirmed',
    };
  }
  const generatedAt = `${shiftDate(snapshot.date, 1)}T07:10:00+09:00`;
  return {
    source: 'cloudflare-cron',
    status: 'complete',
    includesCash: true,
    valuationBasis: 'eod',
    valuationTimestamp: generatedAt,
    generatedAt,
    valuationValidation: 'confirmed',
    ...snapshot,
  };
});

const calculateDailyTwr = (input) => calculateDailyTwrRaw({
  ...input, snapshots: formalizeSnapshots(input?.snapshots),
});
const calculateAvailableDailyTwr = (input) => calculateAvailableDailyTwrRaw({
  ...input, snapshots: formalizeSnapshots(input?.snapshots),
});
const calculateAnnualDailyTwr = (input) => calculateAnnualDailyTwrRaw({
  ...input, snapshots: formalizeSnapshots(input?.snapshots),
});

test('입금은 day start, 출금은 day end로 Daily TWR을 계산한다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000 },
      { date: '2026-09-02', valueKRW: 1650 },
      { date: '2026-09-03', valueKRW: 1485 },
    ],
    cashFlows: [
      { date: '2026-09-02', type: 'deposit', amountKRW: 500 },
      { date: '2026-09-03', type: 'withdrawal', amountKRW: 165 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.ok(Math.abs(result.dailyReturns[0].rate - 0.1) < 0.0000001);
  assert.ok(Math.abs(result.dailyReturns[1].rate) < 0.0000001);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('일별 수익률은 합산하지 않고 기하연결한다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000 },
      { date: '2026-09-02', valueKRW: 1100 },
      { date: '2026-09-03', valueKRW: 990 },
    ],
  });
  assert.equal(Math.round(result.returnPercent * 100) / 100, -1);
});

test('TWR 계산 가능 시작일 이전 입출금은 계산에 넣지 않는다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-02',
    snapshots: [
      { date: '2026-09-01', valueKRW: 100 },
      { date: '2026-09-02', valueKRW: 1000 },
      { date: '2026-09-03', valueKRW: 1100 },
    ],
    cashFlows: [{ date: '2026-09-01', type: 'deposit', amountKRW: 900 }],
  });
  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent), 10);
});

test('baseline EOD와 같은 날짜 입출금은 이미 평가액에 포함된 것으로 보고 이중 반영하지 않는다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000, status: 'complete' },
      { date: '2026-09-02', valueKRW: 1100, status: 'complete' },
    ],
    cashFlows: [{ date: '2026-09-01', type: 'deposit', amountKRW: 900 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.baselineDate, '2026-09-01');
  assert.equal(result.firstReturnDate, '2026-09-02');
  assert.equal(result.dailyReturns[0].depositsKRW, 0);
  assert.equal(Math.round(result.returnPercent), 10);
});

test('intraday 초기 기준 확정 뒤 같은 날 발생한 입금은 다음 Daily Return에 반영한다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      {
        date: '2026-09-01', valueKRW: 1000, status: 'complete',
        valuationBasis: 'setup-complete', valuationTimestamp: '2026-09-01T01:00:00.000Z',
      },
      { date: '2026-09-02', valueKRW: 1650, status: 'complete' },
    ],
    cashFlows: [{
      date: '2026-09-01', transactionTime: '12:00:00', type: 'deposit', amountKRW: 500,
    }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.dailyReturns[0].depositsKRW, 500);
  assert.equal(Math.round(result.returnPercent), 10);
});

test('정식 Daily TWR은 initializing/provisional/실시간 Snapshot을 사용하지 않는다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000, status: 'complete' },
      { date: '2026-09-02', valueKRW: 1100, status: 'complete' },
      { date: '2026-09-03', valueKRW: 900, status: 'provisional', source: 'live' },
    ],
    performanceEndDate: '2026-09-02',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.endDate, '2026-09-02');
  assert.equal(Math.round(result.returnPercent), 10);
});

test('상태·평가시각이 없는 레거시 client auto Snapshot은 공식 TWR에서 제외한다', () => {
  const result = calculateDailyTwrRaw({
    twrAvailableFrom: '2026-08-24',
    snapshots: [
      { date: '2026-08-24', valueKRW: 1000, source: 'auto' },
      { date: '2026-08-25', valueKRW: 1100, source: 'auto' },
    ],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'snapshot-required');
});

test('누락된 Daily Snapshot이 있으면 계산 불가 날짜를 반환한다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000 },
      { date: '2026-09-03', valueKRW: 1100 },
    ],
  });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'daily-snapshot-missing');
  assert.deepEqual(result.missingSnapshotDates, ['2026-09-02']);
});

test('날짜 정책이 확정한 실제 Snapshot 구간만 정확히 계산한다', () => {
  const result = calculateAvailableDailyTwr({
    accountInceptionDate: '2025-01-07',
    serviceJoinedAt: '2026-05-24',
    twrAvailableFrom: '2026-08-24',
    performanceEndDate: '2026-08-28',
    snapshots: [
      { date: '2026-08-24', valueKRW: 56686538.86552966 },
      { date: '2026-08-25', valueKRW: 56670775.993828095 },
      { date: '2026-08-26', valueKRW: 56832035.79081347 },
      { date: '2026-08-27', valueKRW: 55334370.14775464 },
      { date: '2026-08-28', valueKRW: 55029950.79045547, status: 'complete' },
    ],
    cashFlows: [{ date: '2026-07-14', type: 'deposit', amountKRW: 4476569.62191 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.coverageStatus, 'partial');
  assert.equal(result.accountInceptionDate, '2025-01-07');
  assert.equal(result.serviceJoinedAt, '2026-05-24');
  assert.equal(result.twrAvailableFrom, '2026-08-24');
  assert.equal(result.startDate, '2026-08-24');
  assert.equal(result.endDate, '2026-08-28');
  assert.equal(result.dailyReturns.every((day) => day.depositsKRW === 0), true);
  assert.ok(Math.abs(result.returnPercent - (-2.9223658883176906)) < 0.0000001);
});

test('실제 Snapshot이 2건 미만이면 기록 구간 수익률도 만들지 않는다', () => {
  const result = calculateAvailableDailyTwr({
    twrAvailableFrom: '2026-08-28',
    snapshots: [{ date: '2026-08-28', valueKRW: 1000 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'second-snapshot-required');
  assert.equal(result.returnPercent, null);
});

test('외화 입출금 환율이 없으면 정확한 값으로 표시하지 않는다', () => {
  const result = calculateDailyTwr({
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000 },
      { date: '2026-09-02', valueKRW: 2000 },
    ],
    cashFlows: [{
      id: 'missing-fx', date: '2026-09-02', type: 'deposit', amountKRW: null,
    }],
  });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'fx-rate-missing');
});

test('과거 입출금을 추가하면 저장값 없이 전체 기간을 다시 계산한다', () => {
  const input = {
    twrAvailableFrom: '2026-09-01',
    snapshots: [
      { date: '2026-09-01', valueKRW: 1000 },
      { date: '2026-09-02', valueKRW: 2100 },
      { date: '2026-09-03', valueKRW: 2200 },
    ],
  };
  const beforeImport = calculateDailyTwr(input);
  const afterImport = calculateDailyTwr({
    ...input,
    cashFlows: [{ date: '2026-09-02', type: 'deposit', amountKRW: 1000 }],
  });

  assert.ok(beforeImport.returnPercent > 100);
  assert.ok(afterImport.returnPercent < 11);
});

test('E. 연도 중간부터 데이터가 있으면 해당 날짜 이후 기록 구간으로 표시한다', () => {
  const result = calculateAnnualDailyTwr({
    year: 2026,
    accountInceptionDate: '2025-01-07',
    serviceJoinedAt: '2026-05-24',
    twrAvailableFrom: '2026-08-24',
    asOfDate: '2026-08-26',
    snapshots: [
      { date: '2026-08-24', valueKRW: 1000 },
      { date: '2026-08-25', valueKRW: 1650 },
      { date: '2026-08-26', valueKRW: 1815 },
    ],
    cashFlows: [
      { date: '2026-07-14', type: 'deposit', amountKRW: 3000 },
      { date: '2026-08-25', type: 'deposit', amountKRW: 500 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 21);
  assert.equal(result.depositsKRW, 500);
  assert.equal(result.profitKRW, 315);
  assert.equal(result.periodType, 'recorded-period-twr');
  assert.equal(result.startDate, '2026-08-24');
});

test('진행 중인 연도는 오늘 장중 값 대신 마지막 COMPLETE Snapshot까지만 계산한다', () => {
  const result = calculateAnnualDailyTwr({
    year: 2026,
    twrAvailableFrom: '2026-08-24',
    asOfDate: '2026-08-29',
    snapshots: [
      { date: '2026-08-24', valueKRW: 1000, status: 'complete' },
      { date: '2026-08-25', valueKRW: 1100, status: 'complete' },
      { date: '2026-08-26', valueKRW: 1210, status: 'complete' },
      { date: '2026-08-27', valueKRW: 1331, status: 'complete' },
      { date: '2026-08-28', valueKRW: 1464.1, status: 'complete' },
      { date: '2026-08-29', valueKRW: 1200, status: 'provisional', source: 'live' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.endDate, '2026-08-28');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 46.41);
  assert.equal(result.periodType, 'recorded-period-twr');
});

test('연도별 TWR은 누락 Snapshot이 있으면 기존 손익률로 대신 표시하지 않는다', () => {
  const result = calculateAnnualDailyTwr({
    year: 2026,
    accountInceptionDate: '2025-01-07',
    serviceJoinedAt: '2026-05-24',
    twrAvailableFrom: '2026-08-24',
    asOfDate: '2026-08-26',
    snapshots: [
      { date: '2026-08-24', valueKRW: 1000 },
      { date: '2026-08-26', valueKRW: 1100 },
    ],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.returnPercent, null);
  assert.equal(result.reason, 'daily-snapshot-missing');
  assert.deepEqual(result.missingSnapshotDates, ['2026-08-25']);
});

test('연간 TWR은 직전 연도 EOD baseline에서 해당 연도 첫 수익률을 시작한다', () => {
  const result = calculateAnnualDailyTwr({
    year: 2026,
    accountInceptionDate: '2025-12-01',
    serviceJoinedAt: '2025-12-01',
    twrAvailableFrom: '2025-12-31',
    asOfDate: '2026-01-02',
    snapshots: [
      { date: '2025-12-31', valueKRW: 1000, status: 'complete' },
      { date: '2026-01-01', valueKRW: 1100, status: 'complete' },
      { date: '2026-01-02', valueKRW: 1210, status: 'complete' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.periodType, 'calendar-year-twr');
  assert.equal(result.baselineDate, '2025-12-31');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(Math.round(result.returnPercent), 21);
});

test('직전 연도 EOD baseline이 없으면 해당 연도 전체 TWR로 표시하지 않는다', () => {
  const result = calculateAnnualDailyTwr({
    year: 2026,
    twrAvailableFrom: '2025-12-01',
    asOfDate: '2026-01-02',
    snapshots: [
      { date: '2026-01-01', valueKRW: 1100, status: 'complete' },
      { date: '2026-01-02', valueKRW: 1210, status: 'complete' },
    ],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'annual-opening-baseline-required');
  assert.equal(result.requiredBaselineDate, '2025-12-31');
});

test('계좌 활동 연도는 목록에 보이되 TWR 가능일 이전 연도는 계산 불가다', () => {
  assert.deepEqual(getAnnualTwrYears({
    accountInceptionDate: '2025-01-07',
    serviceJoinedAt: '2026-05-24',
    twrAvailableFrom: '2026-08-24',
    currentYear: 2026,
  }), [2026, 2025]);

  const result = calculateAnnualDailyTwr({
    year: 2025,
    accountInceptionDate: '2025-01-07',
    serviceJoinedAt: '2026-05-24',
    twrAvailableFrom: '2026-08-24',
    asOfDate: '2026-08-28',
    cashFlows: [{ date: '2025-05-30', type: 'deposit', amountKRW: 1000 }],
  });
  assert.equal(result.reason, 'before-twr-availability');
});
