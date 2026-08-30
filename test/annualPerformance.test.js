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

test('출금이 순입금을 음수로 만들어도, 그 해 첫 평가액을 원금 기준으로 삼아 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2026-01-01',
    snapshots: [{ date: '2026-08-20', valueKRW: 500, unrealizedProfitKRW: 0, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  // 순입금이 -100원이라 그것만으로는 나눌 원금이 없다. 그렇다고 '자료 부족'으로
  // 비워두는 대신, 실제로 관측된 평가액 500원을 원금 기준으로 쓴다.
  assert.equal(result.status, 'ready');
  assert.equal(result.capitalBasis, 'first-snapshot');
  assert.equal(result.capitalBaseKRW, 500);
  assert.equal(result.returnPercent, 0);
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

test('연초 기준값이 없으면 그 해 첫 평가액에서 평가이익을 뺀 값을 원금으로 본다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      // 이 평가액에는 당일 입금 500원과, 그때까지 쌓인 평가이익 60원이 들어 있다.
      { date: '2026-05-10', valueKRW: 1500, unrealizedProfitKRW: 60, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1650, unrealizedProfitKRW: 90, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2026-05-10', type: 'deposit', amountKRW: 500 },
    ],
  });

  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.openingBasis, 'assumed-zero');
  // 올해 입금(500원)만 세면 작년까지 넣어둔 940원이 통째로 빠져 수익률이 부풀려진다.
  // 첫 평가액 1,500원에서 평가이익 60원을 뺀 1,440원이 실제 원금에 가장 가깝다.
  assert.equal(result.capitalBaseKRW, 1440);
  assert.equal(result.profitKRW, 90);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 6.25);
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
  // 2년 전 평가액을 올해 연초 기준으로 끌어오지 않는다(이월 없음).
  assert.equal(stale.carriedForward, false);
  assert.equal(stale.openingBasis, 'assumed-zero');
  assert.equal(stale.startValueKRW, 0);

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

test('같은 날짜에 기록이 겹치면 이월도 마지막 값을 쓴다', () => {
  const build = (snapshots) => calculateAnnualPerformance({ year: 2026, snapshots });
  const ordered = [
    { date: '2025-12-31', valueKRW: 9999, unrealizedProfitKRW: 9999, source: 'auto' },
    { date: '2025-12-31', valueKRW: 1000, unrealizedProfitKRW: 100, source: 'auto' },
    { date: '2026-08-22', valueKRW: 1100, unrealizedProfitKRW: 150, source: 'auto' },
  ];

  assert.equal(build(ordered).startValueKRW, 1000);
  assert.equal(Math.round(build(ordered).returnPercent * 100) / 100, 5);
});

test('첫 평가액에 이미 반영된 입금을 원금에 두 번 더하지 않는다', () => {
  // 5/10 평가액에는 그날 입금 500원이 이미 들어가 있다. 원금 후보를 더하는 게
  // 아니라 가장 큰 하나만 고르므로 1,940원(=1,440+500)이 되지 않는다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-05-10', valueKRW: 1500, unrealizedProfitKRW: 60, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1650, unrealizedProfitKRW: 90, source: 'auto' },
    ],
    capitalFlows: [{ date: '2026-05-10', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(result.capitalBaseKRW, 1440);
});

test('신규 사용자는 연초 평가액 없이 입금과 현재 평가액만으로도 계산한다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 580, unrealizedProfitKRW: 80, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'deposit', amountKRW: 500 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(Math.round(result.returnPercent * 100) / 100, 16);
  assert.equal(result.profitKRW, 80);
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.capitalBaseKRW, 500);
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

  // 끝점 평가손익도, 그 해에 판 손익도, 배당도 없다 — 잴 수익 자체가 없다.
  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'current-value-required');
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
  assert.equal(result.openingBasis, 'account-opened');
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.capitalBaseKRW, 1000);
  assert.equal(result.profitKRW, 200);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
  // 기간 중간에 입금이 들어와 단순 비율로 근사했다는 표시.
  assert.equal(result.estimated, true);
});

test('원금 후보가 하나도 없으면(평가액도 0원) 0%로 위장하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2026-01-01',
    snapshots: [{ date: '2026-08-20', valueKRW: 0, unrealizedProfitKRW: 0, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'capital-base-required');
});

test('전년도 입출금까지 이 해로 끌어오지 않고, 구간은 1월 1일부터만 본다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 1300, unrealizedProfitKRW: 400, source: 'current' }],
    capitalFlows: [
      { date: '2025-05-01', type: 'deposit', amountKRW: 800 },
      { date: '2026-03-01', type: 'deposit', amountKRW: 100 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.carriedForward, false);
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.profitKRW, 400);
  // 2025년 입금 800원은 2025년 몫이라 이 해의 '이 기간 입금'에 들어가지 않는다.
  assert.equal(result.depositsKRW, 100);
  // 그래도 원금은 올해 입금 100원이 아니라, 실제 평가액에서 평가이익을 뺀 900원으로 본다.
  assert.equal(result.capitalBaseKRW, 900);
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
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.openingBasis, 'carried-forward');
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

test('오래된 입출금·배당이 여러 해의 카드에 중복으로 잡히지 않는다', () => {
  // 2024년 입금·배당은 2024년 몫이다. 각 해가 자기 구간(1/1~)만 보므로 2025년과
  // 2026년 카드가 같은 2024년 기록을 나눠 갖는 일이 없다.
  const snapshots = [
    { date: '2025-06-01', valueKRW: 1000, unrealizedProfitKRW: 50, source: 'auto' },
    { date: '2026-06-01', valueKRW: 1000, unrealizedProfitKRW: 50, source: 'auto' },
  ];
  const capitalFlows = [{ date: '2024-01-01', type: 'deposit', amountKRW: 1000 }];
  const dividends = [{ date: '2024-06-01', amountKRW: 300 }];

  const year2025 = calculateAnnualPerformance({ year: 2025, snapshots, capitalFlows, dividends });
  assert.equal(year2025.status, 'ready');
  assert.equal(year2025.startDate, '2025-01-01');
  assert.equal(year2025.depositsKRW, 0);
  assert.equal(year2025.dividendsKRW, 0);

  const year2026 = calculateAnnualPerformance({ year: 2026, snapshots, capitalFlows, dividends });
  assert.equal(year2026.status, 'ready');
  assert.equal(year2026.depositsKRW, 0);
  assert.equal(year2026.dividendsKRW, 0);
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

test('오늘 자동 평가액은 최신 화면 값으로 바꾼다', () => {
  assert.equal(withCurrentPortfolioSnapshot(
    [{ date: '2026-08-20', valueKRW: 10_000, source: 'auto' }],
    { date: '2026-08-20', valueKRW: 12_000 },
  )[0].valueKRW, 12_000);
});

test('하루 한 번 저장한 평가액은 그날 다시 호출해도 덮지 않는다', () => {
  const automatic = upsertDailyPortfolioSnapshot(
    [{ id: 'old', date: '2026-08-18', valueKRW: 1000, source: 'auto' }],
    { date: '2026-08-18', valueKRW: 1100, source: 'auto' },
  );
  assert.equal(automatic[0].valueKRW, 1000);
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

test('올해 가입했다면 기록을 늦게 시작해도 구간은 1월 1일부터 본다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2026-08-25',
    snapshots: [
      { date: '2026-08-25', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'auto' },
      { date: '2026-08-26', valueKRW: 1100, unrealizedProfitKRW: 100, source: 'auto' },
      { date: '2026-08-27', valueKRW: 1250, unrealizedProfitKRW: 250, source: 'current' },
    ],
    capitalFlows: [{ date: '2026-08-25', type: 'deposit', amountKRW: 1000 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.endDate, '2026-08-27');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.inferredStart, false);
  assert.equal(result.depositsKRW, 1000);
  assert.equal(result.profitKRW, 250);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 25);
});

test('작년 이전에 가입했어도 구간은 8/25가 아니라 1월 1일부터 본다', () => {
  // 예전에는 기록을 시작한 8/25를 시작점으로 잡아, 며칠 사이의 평가이익이 그
  // 며칠치 원금으로 나뉘며 수십 %가 튀어나왔다. 이제는 라벨(YTD)과 계산 구간이
  // 같은 뜻이 되도록 언제나 1월 1일부터 본다.
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2025-03-01',
    snapshots: [
      { date: '2026-08-25', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'auto' },
      { date: '2026-08-27', valueKRW: 1250, unrealizedProfitKRW: 250, source: 'current' },
    ],
    capitalFlows: [{ date: '2026-08-25', type: 'deposit', amountKRW: 1000 }],
  });

  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.openingBasis, 'assumed-zero');
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.capitalBaseKRW, 1000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 25);
});

test('8월에 기록을 시작해도 며칠짜리 구간으로 좁혀 수익률을 부풀리지 않는다', () => {
  // 실제로 보고된 문제: 8/25에 기록을 시작한 계좌가 "5일 만에 +21.49%"로 보였다.
  // 원인은 구간이 8/25~오늘로 좁혀지면서, 그 계좌가 지금까지 쌓아온 평가이익
  // 전부가 며칠치 변화로 잡힌 것이었다. 구간을 1/1로 고정하면 같은 이익이
  // "올해 누적"이라는 제 이름을 달고, 원금도 실제 매입원가로 나뉜다.
  const result = calculateAnnualPerformance({
    year: 2026,
    joinedAt: '2024-02-01',
    snapshots: [
      { date: '2026-08-25', valueKRW: 5_343_793, unrealizedProfitKRW: 0, source: 'auto' },
      { date: '2026-08-30', valueKRW: 6_492_074, unrealizedProfitKRW: 1_148_281, source: 'current' },
    ],
    costBasisKRW: 5_343_793,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.endDate, '2026-08-30');
  assert.equal(result.profitKRW, 1_148_281);
  assert.equal(result.capitalBaseKRW, 5_343_793);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 21.49);
});

test('연초 기준값이 없으면 실제 매입원가를 원금으로 쓴다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-08-25', valueKRW: 1_200, unrealizedProfitKRW: 200, source: 'auto' },
      { date: '2026-08-30', valueKRW: 1_300, unrealizedProfitKRW: 300, source: 'current' },
    ],
    // 현금 200원을 뺀 실제 매입원가. 첫 평가액에서 평가이익을 뺀 1,000원보다 크다.
    costBasisKRW: 1_500,
  });

  assert.equal(result.capitalBasis, 'cost-basis');
  assert.equal(result.capitalBaseKRW, 1_500);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
});

test('같은 날짜 기록이 섞여 들어와도 배열 순서와 무관하게 같은 값을 고른다', () => {
  // 로컬 저장분과 클라우드 저장분이 합쳐지는 순서는 로그인·동기화 타이밍에 따라
  // 매번 달라진다. 순서에 따라 기준값이 바뀌면 새로고침할 때마다 수익률이 흔들린다.
  const auto = { date: '2026-08-30', valueKRW: 1_000, unrealizedProfitKRW: 100, source: 'auto' };
  const current = { date: '2026-08-30', valueKRW: 1_400, unrealizedProfitKRW: 400, source: 'current' };
  const opening = { date: '2026-01-01', valueKRW: 1_000, unrealizedProfitKRW: 0, source: 'manual' };

  const forward = calculateAnnualPerformance({ year: 2026, snapshots: [opening, auto, current] });
  const backward = calculateAnnualPerformance({ year: 2026, snapshots: [opening, current, auto] });

  assert.equal(forward.returnPercent, backward.returnPercent);
  assert.equal(forward.endValueKRW, 1_400);
  assert.equal(backward.endValueKRW, 1_400);
});
