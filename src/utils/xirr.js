// 현금흐름 기반 연환산 수익률(XIRR).
//
// 연도별 수익률(annualIncomeReturn)은 "손익 ÷ 투입원가"라는 단순 비율이라
// 돈이 언제 들어왔는지를 보지 않는다. 1월에 넣은 1,000만원과 12월에 넣은
// 1,000만원이 같은 무게로 분모에 들어가므로, 연말에 크게 사면 수익률이
// 실제보다 낮게 보인다. XIRR은 각 현금흐름을 날짜로 할인해 그 왜곡을 없앤다.
//
// 계산은 "순현재가치(NPV)를 0으로 만드는 할인율 찾기"다. 뉴턴법으로 빠르게
// 접근하되, 발산하거나 범위를 벗어나면 이분법으로 확실히 수렴시킨다.

const MS_PER_DAY = 86400000;
const DAYS_PER_YEAR = 365;

const toTime = (value) => {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00+09:00`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : NaN;
};

/** 할인율 rate에서의 순현재가치. 0이 되는 지점이 곧 연환산 수익률이다. */
const netPresentValue = (flows, rate) => flows.reduce((sum, flow) => (
  sum + (flow.amount / ((1 + rate) ** (flow.years)))
), 0);

/**
 * @param {{date: string|Date, amount: number}[]} cashflows
 *   투자에서 나간 돈은 음수, 들어온 돈(매도대금·배당)과 현재 평가금액은 양수.
 * @returns {number|null} 연환산 수익률(%). 계산할 수 없으면 null.
 */
export const calculateXirr = (cashflows = []) => {
  const flows = cashflows
    .map((flow) => ({ time: toTime(flow.date), amount: Number(flow.amount) }))
    .filter((flow) => Number.isFinite(flow.time) && Number.isFinite(flow.amount) && flow.amount !== 0)
    .sort((left, right) => left.time - right.time);

  // 부호가 한쪽뿐이면 (전부 투입만 했거나 전부 회수만 했거나) 해가 없다.
  if (flows.length < 2) return null;
  if (!flows.some((flow) => flow.amount > 0) || !flows.some((flow) => flow.amount < 0)) return null;

  const start = flows[0].time;
  const dated = flows.map((flow) => ({
    amount: flow.amount,
    years: (flow.time - start) / MS_PER_DAY / DAYS_PER_YEAR,
  }));
  // 전부 같은 날이면 기간이 0이라 연환산이 성립하지 않는다.
  if (dated[dated.length - 1].years <= 0) return null;

  /**
   * 허용 오차는 금액 규모에 비례해야 한다. 원 단위 수천만원을 다루면서
   * 절대값 1e-7을 요구하면 사실상 도달할 수 없는 기준이 된다.
   */
  const scale = dated.reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const tolerance = Math.max(1e-7, scale * 1e-10);

  // 1) 뉴턴법. 미분값이 0에 가까우면 즉시 포기하고 이분법으로 넘어간다.
  let rate = 0.1;
  for (let step = 0; step < 60; step += 1) {
    const value = netPresentValue(dated, rate);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) < tolerance) return rate * 100;
    const slope = dated.reduce((sum, flow) => (
      sum - ((flow.years * flow.amount) / ((1 + rate) ** (flow.years + 1)))
    ), 0);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
    const next = rate - (value / slope);
    // -100%(원금 전액 손실) 아래로는 (1 + rate)가 음수가 되어 거듭제곱이 깨진다.
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) return next * 100;
    rate = next;
  }

  // 2) 이분법. 부호가 바뀌는 구간을 먼저 찾고 그 안에서 좁힌다.
  // 상장폐지처럼 원금을 거의 다 잃는 경우까지 담으려면 -100%에 바싹 붙어야 한다.
  let low = -0.999999;
  let high = 1;
  let highValue = netPresentValue(dated, high);
  const lowValue = netPresentValue(dated, low);
  if (!Number.isFinite(lowValue)) return null;
  // 원금을 사실상 전부 잃은 경우. 해가 -100% 바로 위에 있어 구간을 못 잡는다.
  if (Math.abs(lowValue) < tolerance) return low * 100;
  for (let step = 0; step < 200 && Number.isFinite(highValue) && Math.sign(highValue) === Math.sign(lowValue); step += 1) {
    high *= 2;
    highValue = netPresentValue(dated, high);
    if (high > 1e6) return null;
  }
  if (!Number.isFinite(highValue) || Math.sign(highValue) === Math.sign(lowValue)) return null;

  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    const value = netPresentValue(dated, mid);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < tolerance) return mid * 100;
    if (Math.sign(value) === Math.sign(lowValue)) low = mid;
    else high = mid;
  }

  const answer = (low + high) / 2;
  return Number.isFinite(answer) ? answer * 100 : null;
};
