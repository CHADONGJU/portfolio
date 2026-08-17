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

test('입출금과 평가 기록에 포함된 연도를 최신순으로 돌려준다', () => {
  assert.deepEqual(getAnnualPerformanceYears({
    currentYear: 2026,
    snapshots: [{ date: '2024-12-31' }],
    capitalFlows: [{ date: '2025-05-01' }],
  }), [2026, 2025, 2024]);
});
