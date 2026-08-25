import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAnnualPerformance,
  getAnnualPerformanceYears,
  summarizeCapitalFlows,
  upsertDailyPortfolioSnapshot,
  withCurrentPortfolioSnapshot,
} from '../src/utils/annualPerformance.js';

// 연 순수익 = 그 기간의 실현손익 + 배당 + 미실현손익(아직 안 판 것들의 평가손익) 변화.
// 총 평가금액의 변화량으로 수익률을 구하던 예전 방식은, 종목을 팔면 그 평가금액이
// 목록에서 통째로 사라지는데 판 돈을 현금으로 따로 추적하지 않는 한 되돌릴 방법이
// 없어 "이득을 보고 팔아도 손실처럼 보이는" 문제가 있었다. 세 가지를 각자의 방식대로
// (트레이드 기록/배당 기록/평가손익 기록) 따로 더하면 판 돈이 어디로 갔는지와 무관하게
// 항상 맞는 값이 나온다.

test('실현손익·배당·미실현손익 변화를 각각 더해 순수익을 만든다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-12-31', valueKRW: 1200, unrealizedProfitKRW: 150, source: 'auto' },
    ],
    dividends: [{ date: '2026-03-01', amountKRW: 50 }],
    realizedGains: [{ date: '2026-06-01', amountKRW: 200 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.unrealizedChangeKRW, 150);
  assert.equal(result.realizedGainsKRW, 200);
  assert.equal(result.dividendsKRW, 50);
  assert.equal(result.profitKRW, 400);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 40);
  assert.equal(result.estimated, false);
});

test('실현손실도 음수 그대로 반영된다(배당과 달리 손실 매도가 사라지지 않는다)', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-12-31', valueKRW: 900000, unrealizedProfitKRW: 0, source: 'auto' },
    ],
    realizedGains: [{ date: '2026-06-01', amountKRW: -100000 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.realizedGainsKRW, -100000);
  assert.equal(result.profitKRW, -100000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, -10);
});

test('이익과 손실이 같은 해에 섞이면 서로 상쇄된다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 10000000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-08-24', valueKRW: 10000000, unrealizedProfitKRW: 0, source: 'auto' },
    ],
    realizedGains: [
      { date: '2026-03-01', amountKRW: 1000000 },
      { date: '2026-05-01', amountKRW: -1000000 },
    ],
  });

  assert.equal(result.realizedGainsKRW, 0);
  assert.equal(result.profitKRW, 0);
  assert.equal(result.returnPercent, 0);
});

test('종목을 팔아 이득을 봤으면, 그 돈을 현금으로 안 잡아둬도 손실로 보이지 않는다', () => {
  // 연초에 산 종목을 4월에 팔아 실현이익 100을 남겼다(판 돈을 현금 자산으로 따로
  // 만들지 않았다). 남아 있는 종목들의 평가손익은 연말까지 -50으로 변했다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-12-31', valueKRW: 900, unrealizedProfitKRW: -50, source: 'auto' },
    ],
    realizedGains: [{ date: '2026-04-01', amountKRW: 100 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.unrealizedChangeKRW, -50);
  assert.equal(result.realizedGainsKRW, 100);
  assert.equal(result.profitKRW, 50);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 5);
});

test('판 돈으로 같은 해에 다른 종목을 다시 사도 이중으로 잡히지 않는다', () => {
  // 실현이익(200)과, 그 돈을 재투자한 새 종목의 평가손익 변화(100)는 서로 독립된
  // 값이라 겹칠 일이 없다 — 총 평가금액이 얼마로 변했는지는 아예 보지 않는다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-06-01', valueKRW: 1300, unrealizedProfitKRW: 100, source: 'auto' },
    ],
    realizedGains: [{ date: '2026-03-01', amountKRW: 200 }],
  });

  assert.equal(result.profitKRW, 300);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 30);
});

test('미실현손익을 저장하기 전 데이터는 0으로 근사하고 추정으로 표시한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, source: 'manual' },
      { date: '2026-12-31', valueKRW: 1200, unrealizedProfitKRW: 150, source: 'auto' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.unrealizedChangeKRW, 150);
  assert.equal(result.profitKRW, 150);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 15);
  assert.equal(result.estimated, true);
});

test('평가 기록이 한 건뿐이면 연 수익률을 만들어내지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-18', valueKRW: 1000 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.returnPercent, null);
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
});

test('출금으로 원금 기준점이 음수가 되면 계산할 수 없는 값으로 본다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2026-01-01',
    snapshots: [{ date: '2026-08-20', valueKRW: 500, unrealizedProfitKRW: 0, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'capital-base-required');
});

test('중간 스냅샷은 보지 않고 연초·최신 두 값만으로 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-06-01', valueKRW: 0, unrealizedProfitKRW: 9999, source: 'auto' },
      { date: '2026-12-31', valueKRW: 1100, unrealizedProfitKRW: 100, source: 'auto' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.unrealizedChangeKRW, 100);
  assert.equal(result.profitKRW, 100);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('입출금과 평가 기록에 포함된 연도를 최신순으로 돌려준다', () => {
  assert.deepEqual(getAnnualPerformanceYears({
    currentYear: 2026,
    snapshots: [{ date: '2024-12-31' }],
    capitalFlows: [{ date: '2025-05-01' }],
  }), [2026, 2025, 2024]);
});

test('연초 평가액이 없으면 직전 해 마지막 값(평가금액·미실현손익)을 1월 1일로 이월한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-30', valueKRW: 1000, unrealizedProfitKRW: 80, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1500, unrealizedProfitKRW: 130, source: 'auto' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 1000);
  assert.equal(result.unrealizedChangeKRW, 50);
  assert.equal(result.profitKRW, 50);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 5);
  assert.equal(result.carriedForward, true);
  assert.equal(result.carriedForwardAsOfDate, '2025-12-30');
  assert.equal(result.estimated, true);
});

test('이월 구간의 입출금은 연초 원금에 반영하고, 그 해 순수익에는 넣지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-20', valueKRW: 1000, unrealizedProfitKRW: 80, source: 'auto' },
      { date: '2026-06-30', valueKRW: 2200, unrealizedProfitKRW: 130, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2025-12-28', type: 'deposit', amountKRW: 1000 },
    ],
  });

  // 2025-12-28 입금은 2025년 몫이라 연초 원금(2,000원)에 들어가고, 순수익으로는 안 잡힌다.
  assert.equal(result.startValueKRW, 2000);
  assert.equal(result.depositsKRW, 0);
  assert.equal(result.profitKRW, 50);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 2.5);
});

test('마지막 평가 스냅샷 뒤~연말 사이에 받은 배당·판 손익도 그 해 몫으로 잡힌다', () => {
  // 2025년의 마지막 실제 스냅샷은 12/20이지만, 그 뒤 12/25(배당)·12/27(매도)도
  // 여전히 2025년 안이다. 2026년은 이월(1/1부터, day-open)이라 이 날짜들을 볼 수
  // 없으므로, 2025년 쪽이 연말까지 챙겨야 통째로 사라지지 않는다.
  const snapshots = [
    { date: '2025-01-01', valueKRW: 900, unrealizedProfitKRW: 0, source: 'manual' },
    { date: '2025-12-20', valueKRW: 1000, unrealizedProfitKRW: 80, source: 'auto' },
    { date: '2026-06-30', valueKRW: 2200, unrealizedProfitKRW: 130, source: 'auto' },
  ];
  const dividends = [{ date: '2025-12-25', amountKRW: 500 }];
  const realizedGains = [{ date: '2025-12-27', amountKRW: 300 }];

  const year2025 = calculateAnnualPerformance({ year: 2025, snapshots, dividends, realizedGains });
  assert.equal(year2025.dividendsKRW, 500);
  assert.equal(year2025.realizedGainsKRW, 300);
  assert.equal(year2025.profitKRW, 880);

  const year2026 = calculateAnnualPerformance({ year: 2026, snapshots, dividends, realizedGains });
  assert.equal(year2026.dividendsKRW, 0);
  assert.equal(year2026.realizedGainsKRW, 0);
});

test('연초 평가액을 직접 넣었으면 이월하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-30', valueKRW: 9999, unrealizedProfitKRW: 999, source: 'auto' },
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 50, source: 'manual' },
      { date: '2026-08-22', valueKRW: 1100, unrealizedProfitKRW: 80, source: 'auto' },
    ],
  });

  assert.equal(result.startValueKRW, 1000);
  assert.equal(result.carriedForward, false);
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.profitKRW, 30);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 3);
});

test('자동 스냅샷에서 시작하면 그날 입금을 원금에 두 번 넣지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      // 이 평가액에는 당일 입금 500원이 이미 들어가 있다.
      { date: '2026-05-10', valueKRW: 1500, unrealizedProfitKRW: 60, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1650, unrealizedProfitKRW: 90, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2026-05-10', type: 'deposit', amountKRW: 500 },
    ],
  });

  assert.equal(result.startValueKRW, 1500);
  assert.equal(result.depositsKRW, 0);
  assert.equal(result.inferredStart, false);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 2);
});

test('수동 연초 평가액이면 1월 1일 입금을 원금으로 인정한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 500, unrealizedProfitKRW: 20, source: 'manual' },
      { date: '2026-12-31', valueKRW: 1100, unrealizedProfitKRW: 90, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2026-01-01', type: 'deposit', amountKRW: 500 },
    ],
  });

  assert.equal(result.depositsKRW, 500);
  assert.equal(result.profitKRW, 70);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 7);
});

test('배당은 원금이 아니라 그 구간의 수익으로 반영된다(입금·출금과 분리 집계)', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-12-31', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'auto' },
    ],
    dividends: [{ date: '2026-06-01', amountKRW: 50 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.dividendsKRW, 50);
  assert.equal(result.profitKRW, 50);
  assert.equal(result.depositsKRW, 0);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 5);
});

test('너무 오래된 평가액은 연초로 이월하지 않는다', () => {
  const stale = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2024-06-30', valueKRW: 10000000, unrealizedProfitKRW: 500000, source: 'auto' },
      { date: '2026-08-22', valueKRW: 20000000, unrealizedProfitKRW: 900000, source: 'auto' },
    ],
  });
  assert.equal(stale.status, 'insufficient');
  assert.equal(stale.carriedForward, false);

  const fresh = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-11-20', valueKRW: 10000000, unrealizedProfitKRW: 500000, source: 'auto' },
      { date: '2026-08-22', valueKRW: 20000000, unrealizedProfitKRW: 1500000, source: 'auto' },
    ],
  });
  assert.equal(fresh.carriedForward, true);
  assert.equal(fresh.carriedForwardAsOfDate, '2025-11-20');
  assert.equal(Math.round(fresh.returnPercent), 10);
});

test('같은 날짜에 자동/수동 평가액이 겹치면 이월도 수동값을 쓴다', () => {
  const build = (snapshots) => calculateAnnualPerformance({ year: 2026, snapshots });
  const ordered = [
    { date: '2025-12-31', valueKRW: 1000, unrealizedProfitKRW: 100, source: 'manual' },
    { date: '2025-12-31', valueKRW: 9999, unrealizedProfitKRW: 9999, source: 'auto' },
    { date: '2026-08-22', valueKRW: 1100, unrealizedProfitKRW: 150, source: 'auto' },
  ];

  assert.equal(build(ordered).startValueKRW, 1000);
  assert.equal(build([ordered[1], ordered[0], ordered[2]]).startValueKRW, 1000);
  assert.equal(Math.round(build(ordered).returnPercent * 100) / 100, 5);
});

test('가입일 추정 시점에 이미 실제 평가액이 있으면 0원 시작점을 끼워 넣지 않는다', () => {
  // 첫 입금일(=가입일 추정 근거)과 그날의 자동 평가액이 같은 날짜다. 실제
  // 평가액이 이미 그날의 활동을 반영하고 있으므로, 그 앞에 가짜 0원 지점을
  // 만들면 같은 입금이 두 번 잡힌다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-05-10', valueKRW: 1500, unrealizedProfitKRW: 60, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1650, unrealizedProfitKRW: 90, source: 'auto' },
    ],
    capitalFlows: [{ date: '2026-05-10', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(result.inferredStart, false);
  assert.equal(result.startValueKRW, 1500);
});

test('신규 사용자는 연초 평가액 없이 첫 입금과 현재 평가액만으로 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 600, unrealizedProfitKRW: 80, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 16);
  assert.equal(result.profitKRW, 80);
  assert.equal(result.startDate, '2026-08-01');
  assert.equal(result.periodType, 'since-first-deposit');
  assert.equal(result.inferredStart, true);
  assert.equal(result.estimated, false);
});

test('첫 입금일에 가입해도 현재 평가액이 있으면 즉시 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 550, unrealizedProfitKRW: 50, source: 'current' }],
    capitalFlows: [{ date: '2026-08-20', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
  assert.equal(result.profitKRW, 50);
});

test('기록이 출금부터 시작되면 기존 자산 기준값 없이 임의 계산하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 500, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'opening-value-required');
});

test('가입일을 알면 그 날을 0원 시작점으로 삼는다(첫 입출금일이 아니라)', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2026-01-01',
    snapshots: [{ date: '2026-08-20', valueKRW: 1100, unrealizedProfitKRW: 200, source: 'current' }],
    capitalFlows: [{ date: '2026-06-01', type: 'deposit', amountKRW: 1000 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.joinedAtAnchored, true);
  assert.equal(result.periodType, 'since-first-deposit');
  assert.equal(result.profitKRW, 200);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
  // 기간 중간에 입금이 들어와 단순 비율로 근사했다는 표시.
  assert.equal(result.estimated, true);
});

test('가입일이 있으면 첫 기록이 출금이어도 가입 시점(0원)을 기준으로 삼는다 — 다만 입금 없이 출금만 있으면 자본 기반이 없어 여전히 계산할 수 없다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2026-01-01',
    snapshots: [{ date: '2026-08-20', valueKRW: 500, unrealizedProfitKRW: 0, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  assert.equal(result.status, 'insufficient');
  // 출금 자체가 근거라서 막힌 게 아니라(가입일이 있으므로 시작점은 이미 안다),
  // 출금이 원금 기준점을 음수로 만들어 분모를 구성할 수 없어서 막힌 것이다.
  assert.equal(result.reason, 'capital-base-required');
});

test('전년도부터 입출금 기록이 있고 이어받을 평가액이 없으면, 그 연도만 따로 떼지 않고 최초 입출금일(가입일)부터 지금까지를 통째로 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 1300, unrealizedProfitKRW: 400, source: 'current' }],
    capitalFlows: [
      { date: '2025-05-01', type: 'deposit', amountKRW: 800 },
      { date: '2026-03-01', type: 'deposit', amountKRW: 100 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.periodType, 'since-first-deposit');
  assert.equal(result.inferredStart, true);
  assert.equal(result.carriedForward, false);
  assert.equal(result.startDate, '2025-05-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.profitKRW, 400);
  assert.equal(result.depositsKRW, 900);
  // 400 / (0 + 900) — 입금 시점 가중치를 두지 않는 단순 비율.
  assert.equal(Math.round(result.returnPercent * 100) / 100, 44.44);
});

test('가입일 이전 연도는 평가 기록이 전혀 없으면 자료 부족으로 남는다 (그 해만 따로 계산하지 않음)', () => {
  const result = calculateAnnualPerformance({
    year: 2025,
    snapshots: [{ date: '2026-08-20', valueKRW: 1300, unrealizedProfitKRW: 400, source: 'current' }],
    capitalFlows: [
      { date: '2025-05-01', type: 'deposit', amountKRW: 800 },
      { date: '2026-03-01', type: 'deposit', amountKRW: 100 },
    ],
  });

  assert.equal(result.status, 'insufficient');
});

test('전년도 마지막 평가액이 기록돼 있으면 그 값을 이어받아 자동으로 계산한다(가입일보다 우선)', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-30', valueKRW: 1000, unrealizedProfitKRW: 60, source: 'auto' },
      { date: '2026-08-20', valueKRW: 1300, unrealizedProfitKRW: 130, source: 'current' },
    ],
    capitalFlows: [
      { date: '2025-05-01', type: 'deposit', amountKRW: 800 },
      { date: '2026-03-01', type: 'deposit', amountKRW: 100 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.periodType, 'carried-forward');
  assert.equal(result.carriedForward, true);
  assert.equal(result.carriedForwardAsOfDate, '2025-12-30');
  assert.equal(result.carriedForwardValueKRW, 1000);
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 1000);
  assert.equal(result.profitKRW, 70);
  assert.equal(result.depositsKRW, 100);
});

test('연초 평가액을 직접 입력했다면 전년도 기록과 관계없이 그 값을 그대로 쓴다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-06-01', valueKRW: 5000, unrealizedProfitKRW: 1000, source: 'auto' },
      { date: '2026-01-01', valueKRW: 900, unrealizedProfitKRW: 40, source: 'manual' },
      { date: '2026-08-20', valueKRW: 1300, unrealizedProfitKRW: 100, source: 'current' },
    ],
    capitalFlows: [{ date: '2025-05-01', type: 'deposit', amountKRW: 800 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.carriedForward, false);
  assert.equal(result.startValueKRW, 900);
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.profitKRW, 60);
});

test('가입일 이전 다른 해에 이미 실제 평가액이 있으면, 그 해가 소유한 입출금·배당을 이 해가 다시 가져오지 않는다', () => {
  // 2024년 입금·배당 이후 2025년, 2026년 모두 자기 해의 평가액을 딱 하나씩만
  // 갖고 있다. 2025년은 가입일(2024-01-01)부터 계산할 수 있지만, 2026년까지
  // 같은 가입일로 다시 계산하면 2024년 입금·배당이 두 해의 카드에 똑같이
  // 중복으로 잡힌다. 2026년은 정직하게 자료 부족이어야 한다.
  const snapshots = [
    { date: '2025-06-01', valueKRW: 1000, unrealizedProfitKRW: 50, source: 'auto' },
    { date: '2026-06-01', valueKRW: 1000, unrealizedProfitKRW: 50, source: 'auto' },
  ];
  const capitalFlows = [{ date: '2024-01-01', type: 'deposit', amountKRW: 1000 }];
  const dividends = [{ date: '2024-06-01', amountKRW: 300 }];

  const year2025 = calculateAnnualPerformance({ year: 2025, snapshots, capitalFlows, dividends });
  assert.equal(year2025.status, 'ready');
  assert.equal(year2025.startDate, '2024-01-01');
  assert.equal(year2025.depositsKRW, 1000);
  assert.equal(year2025.dividendsKRW, 300);

  const year2026 = calculateAnnualPerformance({ year: 2026, snapshots, capitalFlows, dividends });
  assert.equal(year2026.status, 'insufficient');
});

test('아직 저장되지 않은 오늘 평가액도 현재 연도 수익률에 즉시 사용한다', () => {
  const snapshots = withCurrentPortfolioSnapshot(
    [{ date: '2026-01-01', valueKRW: 10_000, unrealizedProfitKRW: 0, source: 'manual' }],
    { date: '2026-08-20', valueKRW: 12_000, unrealizedProfitKRW: 2_000 },
  );
  const result = calculateAnnualPerformance({ year: 2026, snapshots });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
});

test('오늘 자동 평가액은 최신 화면 값으로 바꾸되 같은 날짜 수동 평가액은 보존한다', () => {
  assert.equal(withCurrentPortfolioSnapshot(
    [{ date: '2026-08-20', valueKRW: 10_000, source: 'auto' }],
    { date: '2026-08-20', valueKRW: 12_000 },
  )[0].valueKRW, 12_000);

  assert.equal(withCurrentPortfolioSnapshot(
    [{ date: '2026-08-20', valueKRW: 10_000, source: 'manual' }],
    { date: '2026-08-20', valueKRW: 12_000 },
  )[0].valueKRW, 10_000);
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

test('새 날짜의 자동 스냅샷은 기존 기록이 하나도 없어도 실제로 저장된다', () => {
  // 매일 한 번 자동 저장하는 효과가 매번 그냥 no-op이면, 미실현손익 이월에 쓸
  // 과거 기록이 영원히 쌓이지 않는다.
  const saved = upsertDailyPortfolioSnapshot([], {
    date: '2026-08-24', valueKRW: 5000, unrealizedProfitKRW: 100, source: 'auto',
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].valueKRW, 5000);
  assert.equal(saved[0].unrealizedProfitKRW, 100);

  const updated = upsertDailyPortfolioSnapshot(saved, {
    date: '2026-08-25', valueKRW: 5200, unrealizedProfitKRW: 150, source: 'auto',
  });
  assert.equal(updated.length, 2);
  assert.equal(updated[1].valueKRW, 5200);
});

test('순투자원금은 누적 입금에서 누적 출금을 뺀 금액이다', () => {
  assert.deepEqual(summarizeCapitalFlows([
    { type: 'deposit', amountKRW: 15_000 },
    { type: 'withdrawal', amountKRW: 4_000 },
  ]), {
    depositsKRW: 15_000,
    withdrawalsKRW: 4_000,
    netPrincipalKRW: 11_000,
  });
});
