import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateXirr } from '../src/utils/xirr.js';

const round = (value) => Math.round(value * 100) / 100;

test('1년 뒤 10% 늘어난 단순한 경우 10%가 나온다', () => {
  const rate = calculateXirr([
    { date: '2025-01-01', amount: -1000000 },
    { date: '2026-01-01', amount: 1100000 },
  ]);
  assert.equal(round(rate), 10);
});

test('반년 만에 10% 벌면 연환산은 10%보다 크다', () => {
  const rate = calculateXirr([
    { date: '2026-01-01', amount: -1000000 },
    { date: '2026-07-02', amount: 1100000 },
  ]);
  assert.ok(rate > 20 && rate < 22, `연환산 ${rate}%`);
});

test('단순 비율과 달리 돈이 굴러간 기간을 반영한다', () => {
  // 두 해에 걸쳐 100만원씩 넣고 마지막에 220만원을 회수했다.
  // 투입원가 대비 단순 비율은 (220-200)/200 = 10%지만 그건 2년치 합이다.
  // 먼저 넣은 100만원만 2년을 굴렀으므로 연 수익률은 그보다 낮다.
  const rate = calculateXirr([
    { date: '2025-01-01', amount: -1000000 },
    { date: '2026-01-01', amount: -1000000 },
    { date: '2027-01-01', amount: 2200000 },
  ]);
  // x = 1 + r 로 두면 x² + x − 2.2 = 0 → x ≈ 1.0653
  assert.equal(round(rate), 6.52);
  assert.ok(rate < 10, '기간을 무시한 단순 비율(10%)과 같아서는 안 된다');
});

test('같은 총수익이라도 늦게 넣은 돈이 많으면 연 수익률이 높다', () => {
  const early = calculateXirr([
    { date: '2025-01-01', amount: -2000000 },
    { date: '2027-01-01', amount: 2200000 },
  ]);
  const late = calculateXirr([
    { date: '2026-01-01', amount: -2000000 },
    { date: '2027-01-01', amount: 2200000 },
  ]);
  assert.ok(late > early, `늦게 넣은 쪽(${late}%)이 높아야 한다 (${early}%)`);
});

test('손실도 음수로 계산한다', () => {
  const rate = calculateXirr([
    { date: '2025-01-01', amount: -1000000 },
    { date: '2026-01-01', amount: 800000 },
  ]);
  assert.equal(round(rate), -20);
});

test('중간 배당이 수익률을 끌어올린다', () => {
  const withoutDividend = calculateXirr([
    { date: '2025-01-01', amount: -1000000 },
    { date: '2026-01-01', amount: 1100000 },
  ]);
  const withDividend = calculateXirr([
    { date: '2025-01-01', amount: -1000000 },
    { date: '2025-07-01', amount: 30000 },
    { date: '2026-01-01', amount: 1100000 },
  ]);
  assert.ok(withDividend > withoutDividend);
});

test('계산할 수 없는 입력은 null을 돌려준다', () => {
  assert.equal(calculateXirr([]), null);
  assert.equal(calculateXirr([{ date: '2026-01-01', amount: -1000 }]), null);
  // 나가기만 하고 들어온 것이 없으면 해가 없다.
  assert.equal(calculateXirr([
    { date: '2025-01-01', amount: -1000 },
    { date: '2026-01-01', amount: -1000 },
  ]), null);
  // 같은 날짜뿐이면 기간이 0이라 연환산이 성립하지 않는다.
  assert.equal(calculateXirr([
    { date: '2026-01-01', amount: -1000 },
    { date: '2026-01-01', amount: 1100 },
  ]), null);
});

test('원금을 거의 다 잃어도 발산하지 않는다', () => {
  const rate = calculateXirr([
    { date: '2025-01-01', amount: -1000000 },
    { date: '2026-01-01', amount: 1 },
  ]);
  assert.ok(rate !== null && rate < -99, `${rate}%`);
});
