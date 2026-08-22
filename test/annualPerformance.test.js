import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAnnualPerformance,
  getAnnualPerformanceYears,
  upsertDailyPortfolioSnapshot,
} from '../src/utils/annualPerformance.js';

test('인출은 손실로 보지 않고 인출 직전까지의 수익률을 유지한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 500, source: 'manual' },
      { date: '2026-07-01', valueKRW: 400, source: 'auto' },
      { date: '2026-12-31', valueKRW: 400, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2026-07-01', type: 'withdrawal', amountKRW: 200 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
  assert.equal(result.profitKRW, 100);
});

test('평가 기록이 한 건뿐이면 연 수익률을 만들어내지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-18', valueKRW: 1000 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.returnPercent, null);
});

test('하루 한 번 저장한 자동 평가액과 수동 연초 평가액을 덮지 않는다', () => {
  const automatic = upsertDailyPortfolioSnapshot(
    [{ id: 'old', date: '2026-08-18', valueKRW: 1000, source: 'auto' }],
    { date: '2026-08-18', valueKRW: 1100, source: 'auto' },
  );
  assert.equal(automatic[0].valueKRW, 1000);

  const manual = upsertDailyPortfolioSnapshot(
    [{ id: 'manual', date: '2026-01-01', valueKRW: 500, source: 'manual' }],
    { date: '2026-01-01', valueKRW: 900, source: 'auto' },
  );
  assert.equal(manual[0].valueKRW, 500);
});

test('연초 0원에서 첫 입금으로 시작한 포트폴리오도 수익률을 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 0, source: 'manual' },
      { date: '2026-12-31', valueKRW: 600, source: 'auto' },
    ],
    capitalFlows: [{ date: '2026-01-01', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
  assert.equal(result.profitKRW, 100);
});

test('입금일에 평가 스냅샷이 있으면 다음 구간 수익만 연결한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 100 },
      { date: '2026-07-01', valueKRW: 200 },
      { date: '2026-12-31', valueKRW: 220 },
    ],
    capitalFlows: [
      { date: '2026-07-01', type: 'deposit', amountKRW: 100 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
  assert.equal(result.profitKRW, 20);
  assert.equal(result.estimated, false);
});

test('스냅샷 사이 입출금은 수익률을 계산하되 추정으로 표시한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 100 },
      { date: '2026-12-31', valueKRW: 220 },
    ],
    capitalFlows: [
      { date: '2026-07-01', type: 'deposit', amountKRW: 100 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.profitKRW, 20);
  assert.equal(result.estimated, true);
});

test('투자 원금이 전혀 없으면 0% 수익률로 위장하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 0 },
      { date: '2026-12-31', valueKRW: 0 },
    ],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.returnPercent, null);
  assert.equal(result.intervalCount, 0);
});

test('입출금과 평가 기록에 포함된 연도를 최신순으로 돌려준다', () => {
  assert.deepEqual(getAnnualPerformanceYears({
    currentYear: 2026,
    snapshots: [{ date: '2024-12-31' }],
    capitalFlows: [{ date: '2025-05-01' }],
  }), [2026, 2025, 2024]);
});

test('연초 평가액이 없으면 직전 해 마지막 평가액을 1월 1일로 이월한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-30', valueKRW: 1000, source: 'auto' },
      { date: '2026-03-15', valueKRW: 1200, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1500, source: 'auto' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 1000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 50);
  assert.equal(result.profitKRW, 500);
  assert.equal(result.carriedFrom, '2025-12-30');
  assert.equal(result.estimated, true);
});

test('이월 구간의 입출금은 연초 평가액에 반영한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-20', valueKRW: 1000, source: 'auto' },
      { date: '2026-06-30', valueKRW: 2200, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2025-12-28', type: 'deposit', amountKRW: 1000 },
    ],
  });

  // 2025-12-28 입금은 2025년 몫이라 수익이 아니라 연초 원금(2,000원)이 되어야 한다.
  assert.equal(result.startValueKRW, 2000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
  assert.equal(result.profitKRW, 200);
});

test('연초 평가액을 직접 넣었으면 이월하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-30', valueKRW: 9999, source: 'auto' },
      { date: '2026-01-01', valueKRW: 1000, source: 'manual' },
      { date: '2026-08-22', valueKRW: 1100, source: 'auto' },
    ],
  });

  assert.equal(result.startValueKRW, 1000);
  assert.equal(result.carriedFrom, '');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('자동 스냅샷에서 시작하면 그날 입금을 원금에 두 번 넣지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      // 이 평가액에는 당일 입금 500원이 이미 들어가 있다.
      { date: '2026-05-10', valueKRW: 1500, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1650, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2026-05-10', type: 'deposit', amountKRW: 500 },
    ],
  });

  assert.equal(result.startValueKRW, 1500);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('수동 연초 평가액이면 1월 1일 입금을 원금으로 인정한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 500, source: 'manual' },
      { date: '2026-12-31', valueKRW: 1100, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2026-01-01', type: 'deposit', amountKRW: 500 },
    ],
  });

  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
  assert.equal(result.profitKRW, 100);
});

test('수익률과 순수익이 같은 기간을 본다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      // 이 자동 평가액에는 당일 입금 500원이 이미 들어가 있다.
      { date: '2026-05-10', valueKRW: 1500, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1650, source: 'auto' },
    ],
    capitalFlows: [{ date: '2026-05-10', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
  assert.equal(result.profitKRW, 150);
  assert.equal(result.depositsKRW, 0);
});

test('수동 평가액이 구간의 끝이면 그날 입금은 다음 구간 원금으로 넘긴다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-03-01', valueKRW: 100, source: 'auto' },
      { date: '2026-06-01', valueKRW: 100, source: 'manual' },
      { date: '2026-09-01', valueKRW: 150, source: 'auto' },
    ],
    capitalFlows: [{ date: '2026-06-01', type: 'deposit', amountKRW: 50 }],
  });

  // 3~6월 0%, 6~9월 0%. 입금 50원은 수익이 아니다.
  assert.equal(Math.round(result.returnPercent * 100) / 100, 0);
  assert.equal(result.profitKRW, 0);
});

test('너무 오래된 평가액은 연초로 이월하지 않는다', () => {
  const stale = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2024-06-30', valueKRW: 10000000, source: 'auto' },
      { date: '2026-08-22', valueKRW: 20000000, source: 'auto' },
    ],
  });
  assert.equal(stale.status, 'insufficient');
  assert.equal(stale.carriedFrom, '');

  const fresh = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-11-20', valueKRW: 10000000, source: 'auto' },
      { date: '2026-08-22', valueKRW: 20000000, source: 'auto' },
    ],
  });
  assert.equal(fresh.carriedFrom, '2025-11-20');
  assert.equal(Math.round(fresh.returnPercent), 100);
});

test('같은 날짜에 자동/수동 평가액이 겹치면 이월도 수동값을 쓴다', () => {
  const build = (snapshots) => calculateAnnualPerformance({ year: 2026, snapshots });
  const ordered = [
    { date: '2025-12-31', valueKRW: 1000, source: 'manual' },
    { date: '2025-12-31', valueKRW: 9999, source: 'auto' },
    { date: '2026-08-22', valueKRW: 1100, source: 'auto' },
  ];

  assert.equal(build(ordered).startValueKRW, 1000);
  assert.equal(build([ordered[1], ordered[0], ordered[2]]).startValueKRW, 1000);
  assert.equal(Math.round(build(ordered).returnPercent * 100) / 100, 10);
});

test('계산할 수 없는 구간이 섞이면 정확한 값인 척하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, source: 'manual' },
      // 동기화 오류로 0원이 저장된 날. 이 구간은 수익률을 만들 수 없다.
      { date: '2026-02-01', valueKRW: 0, source: 'auto' },
      { date: '2026-03-01', valueKRW: 5000, source: 'auto' },
    ],
  });

  assert.equal(result.estimated, true);
});
