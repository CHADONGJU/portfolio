import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAnnualPerformance,
  getAnnualPerformanceYears,
  summarizeCapitalFlows,
  upsertDailyPortfolioSnapshot,
  withCurrentPortfolioSnapshot,
} from '../src/utils/annualPerformance.js';

// 연 순수익 = 그 해 실현손익(수수료·거래세 차감 후) + 그 해 배당. 평가손익(미실현)은
// 넣지 않는다 — 연초 평가손익 기준값을 알 수 없는 계좌에서 무엇을 가정하든 지어낸
// 숫자가 끼어들고, 실제로 기록 시작 전의 옛 평가손실이 올해 몫으로 청구되는 사고가
// 있었다. 실현손익·배당은 거래일·지급일이 실재해 어느 해 몫인지 언제나 명확하다.

test('순수익은 실현손익과 배당의 합이다', () => {
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
  assert.equal(result.realizedGainsKRW, 200);
  assert.equal(result.dividendsKRW, 50);
  assert.equal(result.profitKRW, 250);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 25);
});

test('평가손익(미실현)은 순수익에 넣지 않는다', () => {
  // 평가액이 1,000 -> 2,000으로 뛰어도 판 게 없으면 실현된 수익이 아니다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-12-31', valueKRW: 2000, unrealizedProfitKRW: 1000, source: 'auto' },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.profitKRW, 0);
  assert.equal(result.returnPercent, 0);
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

test('판 돈을 현금으로 안 잡아둬도, 재투자해도 실현손익은 그대로다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-06-01', valueKRW: 1300, unrealizedProfitKRW: 100, source: 'auto' },
    ],
    realizedGains: [{ date: '2026-03-01', amountKRW: 200 }],
  });

  assert.equal(result.profitKRW, 200);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
});

test('매도도 배당도 없던 해는 0%다 — 평가 기록만으로 수익을 만들어내지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-18', valueKRW: 1000, source: 'auto' }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.profitKRW, 0);
  assert.equal(result.returnPercent, 0);
});

test('평가 기록이 하나도 없으면 나눌 원금이 없어 계산하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    realizedGains: [{ date: '2026-06-01', amountKRW: 100 }],
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
  assert.equal(result.reason, 'capital-base-required');
});

test('중간 스냅샷의 이상값은 결과에 영향을 주지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-01-01', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'manual' },
      { date: '2026-06-01', valueKRW: 0, unrealizedProfitKRW: 9999, source: 'auto' },
      { date: '2026-12-31', valueKRW: 1100, unrealizedProfitKRW: 100, source: 'auto' },
    ],
    realizedGains: [{ date: '2026-07-01', amountKRW: 100 }],
  });

  assert.equal(result.status, 'ready');
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

test('연초 평가액이 없으면 직전 해 마지막 값을 1월 1일로 이월해 원금 기준으로 삼는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-30', valueKRW: 1000, unrealizedProfitKRW: 80, source: 'auto' },
      { date: '2026-08-22', valueKRW: 1500, unrealizedProfitKRW: 130, source: 'auto' },
    ],
    realizedGains: [{ date: '2026-05-01', amountKRW: 50 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 1000);
  assert.equal(result.carriedForward, true);
  assert.equal(result.carriedForwardAsOfDate, '2025-12-30');
  assert.equal(result.profitKRW, 50);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 5);
});

test('이월 구간의 입출금은 연초 원금에 반영하고, 그 해 입금으로는 세지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2025-12-20', valueKRW: 1000, unrealizedProfitKRW: 80, source: 'auto' },
      { date: '2026-06-30', valueKRW: 2200, unrealizedProfitKRW: 130, source: 'auto' },
    ],
    capitalFlows: [
      { date: '2025-12-28', type: 'deposit', amountKRW: 1000 },
    ],
    realizedGains: [{ date: '2026-03-01', amountKRW: 100 }],
  });

  // 2025-12-28 입금은 2025년 몫이라 연초 원금(2,000원)에 들어가고, 이 해 입금이 아니다.
  assert.equal(result.startValueKRW, 2000);
  assert.equal(result.depositsKRW, 0);
  assert.equal(result.profitKRW, 100);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 5);
});

test('마지막 평가 스냅샷 뒤~연말 사이에 받은 배당·판 손익도 그 해 몫으로 잡힌다', () => {
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
  assert.equal(year2025.profitKRW, 800);

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
    realizedGains: [{ date: '2026-04-01', amountKRW: 30 }],
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
    realizedGains: [{ date: '2026-06-01', amountKRW: 144 }],
  });

  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.openingBasis, 'assumed-zero');
  // 올해 입금(500원)만 세면 작년까지 넣어둔 940원이 통째로 빠져 수익률이 부풀려진다.
  // 첫 평가액 1,500원에서 평가이익 60원을 뺀 1,440원이 실제 원금에 가장 가깝다.
  assert.equal(result.capitalBaseKRW, 1440);
  assert.equal(result.profitKRW, 144);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
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
  const realizedGains = [{ date: '2026-06-01', amountKRW: 1_000_000 }];
  const stale = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2024-06-30', valueKRW: 10000000, unrealizedProfitKRW: 500000, source: 'auto' },
      { date: '2026-08-22', valueKRW: 20000000, unrealizedProfitKRW: 900000, source: 'auto' },
    ],
    realizedGains,
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
    realizedGains,
  });
  assert.equal(fresh.carriedForward, true);
  assert.equal(fresh.carriedForwardAsOfDate, '2025-11-20');
  assert.equal(Math.round(fresh.returnPercent), 10);
});

test('같은 날짜에 기록이 겹치면 이월도 늘 같은 값을 고른다', () => {
  const build = (snapshots) => calculateAnnualPerformance({
    year: 2026,
    snapshots,
    realizedGains: [{ date: '2026-05-01', amountKRW: 50 }],
  });
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

test('기록이 출금부터 시작돼도 실현손익·배당 기준이라 계산할 수 있다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 500, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  // 순입금이 음수라도 관측된 평가액 500원이 원금 기준이 된다.
  assert.equal(result.status, 'ready');
  assert.equal(result.capitalBasis, 'first-snapshot');
  assert.equal(result.capitalBaseKRW, 500);
  assert.equal(result.returnPercent, 0);
});

test('원금 후보가 하나도 없으면(평가액도 0원) 0%로 위장하지 않는다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [{ date: '2026-08-20', valueKRW: 0, unrealizedProfitKRW: 0, source: 'current' }],
    capitalFlows: [{ date: '2026-08-01', type: 'withdrawal', amountKRW: 100 }],
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.reason, 'capital-base-required');
});

test('연초 기준값이 없으면 누적 순입금이 아니라 계좌가 실제로 갖고 있던 값으로 나눈다', () => {
  // 앱 가입일은 계산 근거로 쓰지 않는다 — 이 앱에 등록한 날일 뿐이고, 그 전부터
  // 굴리던 계좌였을 수 있다. 대신 그 해 첫 평가액에서 평가이익을 뺀 900원이 원금이다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-08-10', valueKRW: 1050, unrealizedProfitKRW: 150, source: 'auto' },
      { date: '2026-08-20', valueKRW: 1100, unrealizedProfitKRW: 200, source: 'current' },
    ],
    capitalFlows: [{ date: '2026-06-01', type: 'deposit', amountKRW: 1000 }],
    realizedGains: [{ date: '2026-07-01', amountKRW: 90 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.capitalBasis, 'first-snapshot');
  assert.equal(result.capitalBaseKRW, 900);
  assert.equal(result.profitKRW, 90);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('한 해 동안 넣었다 뺐다를 반복해 누적 순입금이 부풀어도 수익률이 짓눌리지 않는다', () => {
  // 실제로 보고된 문제: 5백만 원을 굴리는 계좌인데 올해 누적 순입금이 6천만 원으로
  // 잡혀 수익률이 실제의 10분의 1로 보였다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-08-25', valueKRW: 5_000_000, unrealizedProfitKRW: 0, source: 'auto' },
      { date: '2026-08-30', valueKRW: 5_100_000, unrealizedProfitKRW: 100_000, source: 'current' },
    ],
    capitalFlows: [
      { date: '2026-02-01', type: 'deposit', amountKRW: 60_000_000 },
    ],
    realizedGains: [{ date: '2026-08-03', amountKRW: 1_550_000 }],
    costBasisKRW: 5_000_000,
  });

  assert.equal(result.capitalBaseKRW, 5_000_000);
  assert.equal(result.profitKRW, 1_550_000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 31);
});

test('전년도 입출금까지 이 해로 끌어오지 않고, 구간은 1월 1일부터만 본다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-08-10', valueKRW: 1200, unrealizedProfitKRW: 300, source: 'auto' },
      { date: '2026-08-20', valueKRW: 1300, unrealizedProfitKRW: 400, source: 'current' },
    ],
    capitalFlows: [
      { date: '2025-05-01', type: 'deposit', amountKRW: 800 },
      { date: '2026-03-01', type: 'deposit', amountKRW: 100 },
    ],
    realizedGains: [{ date: '2026-04-01', amountKRW: 90 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.startDate, '2026-01-01');
  // 2025년 입금 800원은 2025년 몫이라 이 해의 '이 기간 입금'에 들어가지 않는다.
  assert.equal(result.depositsKRW, 100);
  assert.equal(result.capitalBaseKRW, 900);
  assert.equal(result.profitKRW, 90);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('가입 이전 연도는 평가 기록이 전혀 없으면 자료 부족으로 남는다', () => {
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

test('전년도 마지막 평가액이 기록돼 있으면 그 값을 이어받아 원금으로 쓴다', () => {
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
    realizedGains: [{ date: '2026-05-01', amountKRW: 110 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.openingBasis, 'carried-forward');
  assert.equal(result.carriedForward, true);
  assert.equal(result.carriedForwardAsOfDate, '2025-12-30');
  assert.equal(result.carriedForwardValueKRW, 1000);
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 1000);
  assert.equal(result.depositsKRW, 100);
  assert.equal(result.profitKRW, 110);
  // 110 / (1000 + 100)
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
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
    realizedGains: [{ date: '2026-05-01', amountKRW: 90 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.carriedForward, false);
  assert.equal(result.startValueKRW, 900);
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.profitKRW, 90);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('오래된 입출금·배당이 여러 해의 카드에 중복으로 잡히지 않는다', () => {
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
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots,
    realizedGains: [{ date: '2026-08-10', amountKRW: 2_000 }],
  });

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
  const saved = upsertDailyPortfolioSnapshot([], {
    date: '2026-08-24', valueKRW: 5000, unrealizedProfitKRW: 100, source: 'auto',
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].valueKRW, 5000);

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

test('기록을 늦게 시작해도 구간은 1월 1일부터 보고, 그 해 실현손익 전부를 센다', () => {
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-08-25', valueKRW: 1000, unrealizedProfitKRW: 0, source: 'auto' },
      { date: '2026-08-27', valueKRW: 1250, unrealizedProfitKRW: 250, source: 'current' },
    ],
    capitalFlows: [{ date: '2026-08-25', type: 'deposit', amountKRW: 1000 }],
    // 기록 시작(8/25)보다 앞선 매도지만 올해 것이므로 전부 잡힌다.
    realizedGains: [{ date: '2026-03-01', amountKRW: 250 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.startValueKRW, 0);
  assert.equal(result.periodType, 'calendar-year');
  assert.equal(result.profitKRW, 250);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 25);
});

test('같은 날짜 기록이 섞여 들어와도 배열 순서와 무관하게 같은 값을 고른다', () => {
  const auto = { date: '2026-08-30', valueKRW: 1_000, unrealizedProfitKRW: 100, source: 'auto' };
  const current = { date: '2026-08-30', valueKRW: 1_400, unrealizedProfitKRW: 400, source: 'current' };
  const opening = { date: '2026-01-01', valueKRW: 1_000, unrealizedProfitKRW: 0, source: 'manual' };

  const forward = calculateAnnualPerformance({ year: 2026, snapshots: [opening, auto, current] });
  const backward = calculateAnnualPerformance({ year: 2026, snapshots: [opening, current, auto] });

  assert.equal(forward.returnPercent, backward.returnPercent);
  assert.equal(forward.endValueKRW, 1_400);
  assert.equal(backward.endValueKRW, 1_400);
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
    realizedGains: [{ date: '2026-06-01', amountKRW: 150 }],
  });

  assert.equal(result.capitalBasis, 'cost-basis');
  assert.equal(result.capitalBaseKRW, 1_500);
  assert.equal(result.profitKRW, 150);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('기록 시작 전의 옛 평가손실이 올해 매도 수익을 깎아먹지 않는다 (실사례)', () => {
  // 실제로 보고된 문제(화면 숫자에서 역산한 데이터). 8/25 기록 시작 시점에 이미
  // 평가손실 -2,404,231원이 쌓여 있던 계좌다. 평가손익을 순수익에 섞던 시절엔 이
  // 옛 손실이 올해 몫으로 청구되어 매도로 번 1,624,723원 + 배당 16,903원이
  // 192,151원(+2.48%)으로 표시됐다. 순수익 = 실현손익 + 배당이므로 이제 평가손실은
  // 아예 개입하지 않는다.
  const result = calculateAnnualPerformance({
    year: 2026,
    snapshots: [
      { date: '2026-08-25', valueKRW: 5_343_793, unrealizedProfitKRW: -2_404_231, source: 'auto' },
      { date: '2026-08-30', valueKRW: 6_298_549, unrealizedProfitKRW: -1_449_475, source: 'current' },
    ],
    realizedGains: [
      { date: '2026-08-03', amountKRW: 1_089_086 },
      { date: '2026-08-21', amountKRW: 348_714 },
      { date: '2026-08-26', amountKRW: 127_369 },
      { date: '2026-08-26', amountKRW: 59_554 },
    ],
    dividends: [
      { date: '2026-08-03', amountKRW: 15_778 },
      { date: '2026-08-21', amountKRW: 1_125 },
    ],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.startDate, '2026-01-01');
  assert.equal(result.realizedGainsKRW, 1_624_723);
  assert.equal(result.dividendsKRW, 16_903);
  assert.equal(result.profitKRW, 1_641_626);
  // 원금 = 8/25 평가액 - 그 시점 평가손익 = 7,748,024원.
  assert.equal(result.capitalBaseKRW, 7_748_024);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 21.19);
});
