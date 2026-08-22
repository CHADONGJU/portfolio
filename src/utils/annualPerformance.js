const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-8;

const toDateKey = (value) => String(value || '').slice(0, 10);

const getTime = (value) => {
  const time = new Date(`${toDateKey(value)}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : NaN;
};

const normalizeSnapshots = (snapshots = [], year) => {
  const byDate = new Map();

  snapshots.forEach((snapshot) => {
    const date = toDateKey(snapshot?.date);
    const valueKRW = Number(snapshot?.valueKRW);
    if (!date.startsWith(`${year}-`) || !Number.isFinite(valueKRW) || valueKRW < 0) return;

    const previous = byDate.get(date);
    if (!previous || snapshot.source === 'manual' || previous.source !== 'manual') {
      byDate.set(date, { ...snapshot, date, valueKRW });
    }
  });

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

/**
 * 스냅샷이 "그날 언제의 값"인지.
 * - 사용자가 넣은 연초 평가액과 이월값은 그날 장이 열리기 전(=하루의 시작) 값이다.
 *   그래서 그날 입금은 아직 안 들어가 있고, 다음 구간의 원금으로 쳐야 한다.
 * - 자동 저장 스냅샷은 그날 마감 뒤 평가액이라 그날 입금이 이미 들어가 있다.
 * 이 구분을 놓치면 같은 입금이 두 번 잡히거나 통째로 빠진다.
 */
const isDayOpenSnapshot = (snapshot = {}) => (
  snapshot.source === 'manual' || snapshot.source === 'carried'
);

const normalizeFlow = (flow) => {
  const date = toDateKey(flow?.date);
  const amountKRW = Math.abs(Number(flow?.amountKRW) || 0);
  const signedAmountKRW = flow?.type === 'withdrawal' ? -amountKRW : amountKRW;
  return { ...flow, date, amountKRW, signedAmountKRW };
};

const normalizeFlows = (capitalFlows = [], year) => capitalFlows
  .map(normalizeFlow)
  .filter((flow) => flow.date.startsWith(`${year}-`) && flow.amountKRW > 0)
  .sort((left, right) => left.date.localeCompare(right.date));

/**
 * 연초 평가액 이월.
 *
 * 예전에는 해당 연도 안에 있는 스냅샷만 봤다. 그래서 올해 첫 자동 저장이 3월이면
 * 1~3월 수익이 통째로 빠진 값을 "올해 수익률"이라고 불렀다.
 * 직전 해의 마지막 평가액을 가져와, 그 뒤 연말까지의 입출금만 더해 1월 1일
 * 시작값으로 삼는다(그 구간에 시세 변동이 없었다고 보는 이월이라 estimated로 표시).
 */
const buildCarriedOpeningSnapshot = (snapshots = [], capitalFlows = [], year) => {
  const openingDate = `${year}-01-01`;

  // 너무 오래된 평가액을 끌어오면 지난 몇 년치 수익이 통째로 올해 것이 된다.
  // 직전 해 11월 이후 기록만 연초로 이월한다.
  const earliestCarryDate = `${year - 1}-11-01`;

  const candidates = new Map();
  snapshots.forEach((snapshot) => {
    const date = toDateKey(snapshot?.date);
    const valueKRW = Number(snapshot?.valueKRW);
    if (!date || date < earliestCarryDate || date >= openingDate) return;
    if (!Number.isFinite(valueKRW) || valueKRW < 0) return;

    // normalizeSnapshots와 같은 규칙: 같은 날짜면 사용자가 넣은 값이 이긴다.
    const existing = candidates.get(date);
    if (!existing || snapshot.source === 'manual' || existing.source !== 'manual') {
      candidates.set(date, { date, valueKRW, source: snapshot.source || 'auto' });
    }
  });

  const previous = [...candidates.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-1)[0];

  if (!previous) return null;

  const previousOpensDay = isDayOpenSnapshot(previous);
  const gapFlow = capitalFlows
    .map(normalizeFlow)
    .filter((flow) => (
      flow.amountKRW > 0
      && (previousOpensDay ? flow.date >= previous.date : flow.date > previous.date)
      && flow.date < openingDate
    ))
    .reduce((sum, flow) => sum + flow.signedAmountKRW, 0);

  const valueKRW = previous.valueKRW + gapFlow;
  if (!(valueKRW >= 0)) return null;

  return {
    id: `carried-${year}`,
    date: openingDate,
    valueKRW,
    source: 'carried',
    carriedFrom: previous.date,
  };
};

/**
 * 이 입출금이 [start, end] 구간의 원금 변동인지.
 * 하루의 시작 값(수동·이월)과 하루의 끝 값(자동)을 구분해 경계 당일 입금을
 * 정확히 한 구간에만 넣는다.
 */
const isFlowInInterval = (flow, start, end) => {
  const afterStart = isDayOpenSnapshot(start) ? flow.date >= start.date : flow.date > start.date;
  const beforeEnd = isDayOpenSnapshot(end) ? flow.date < end.date : flow.date <= end.date;
  return afterStart && beforeEnd;
};

const calculateIntervalReturn = (start, end, flows) => {
  const startTime = getTime(start.date);
  const endTime = getTime(end.date);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;

  const netFlow = flows.reduce((sum, flow) => sum + flow.signedAmountKRW, 0);
  const weightedFlow = flows.reduce((sum, flow) => {
    const flowTime = getTime(flow.date);
    if (!Number.isFinite(flowTime)) return sum;
    const remainingWeight = Math.max(0, Math.min(1, (endTime - flowTime) / (endTime - startTime || DAY_MS)));
    return sum + flow.signedAmountKRW * remainingWeight;
  }, 0);
  const denominator = start.valueKRW + weightedFlow;
  const profit = end.valueKRW - start.valueKRW - netFlow;

  if (!(denominator > EPSILON)) {
    return Math.abs(profit) <= EPSILON
      ? { returnRate: 0, netFlow, estimated: false, inactive: true }
      : null;
  }

  return {
    returnRate: profit / denominator,
    netFlow,
    estimated: flows.some((flow) => flow.date > start.date && flow.date < end.date),
    inactive: false,
  };
};

export const calculateAnnualPerformance = ({ snapshots = [], capitalFlows = [], year } = {}) => {
  const numericYear = Number(year);
  const ownSnapshots = normalizeSnapshots(snapshots, numericYear);
  const needsCarriedOpening = ownSnapshots.length > 0
    && !ownSnapshots.some((snapshot) => snapshot.date === `${numericYear}-01-01`);
  const carriedOpening = needsCarriedOpening
    ? buildCarriedOpeningSnapshot(snapshots, capitalFlows, numericYear)
    : null;
  const usedCarriedOpening = Boolean(carriedOpening) && ownSnapshots.length > 0;
  const yearSnapshots = usedCarriedOpening
    ? [carriedOpening, ...ownSnapshots]
    : ownSnapshots;
  const yearFlows = normalizeFlows(capitalFlows, numericYear);
  const depositsKRW = yearFlows
    .filter((flow) => flow.type !== 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);
  const withdrawalsKRW = yearFlows
    .filter((flow) => flow.type === 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);

  if (yearSnapshots.length < 2) {
    return {
      year: numericYear,
      status: 'insufficient',
      returnPercent: null,
      profitKRW: null,
      depositsKRW,
      withdrawalsKRW,
      startDate: yearSnapshots[0]?.date || '',
      endDate: yearSnapshots[0]?.date || '',
      snapshotCount: yearSnapshots.length,
      openingSource: yearSnapshots[0]?.source || 'auto',
      carriedFrom: '',
      estimated: false,
    };
  }

  let growthFactor = 1;
  let estimated = false;
  let validIntervalCount = 0;

  for (let index = 1; index < yearSnapshots.length; index += 1) {
    const start = yearSnapshots[index - 1];
    const end = yearSnapshots[index];
    const intervalFlows = yearFlows.filter((flow) => isFlowInInterval(flow, start, end));
    const interval = calculateIntervalReturn(start, end, intervalFlows);
    // 평가액이 0으로 저장된 날 등 계산할 수 없는 구간. 통째로 빠졌다는 사실을 남긴다.
    if (!interval) {
      estimated = true;
      continue;
    }

    if (interval.inactive) continue;

    const intervalGrowthFactor = 1 + interval.returnRate;
    // -100%를 넘는 구간은 복리 사슬을 뒤집어 버리므로 제외하되, 값이 통째로
    // 빠졌다는 사실은 estimated로 남겨 화면이 "정확한 값"인 척하지 않게 한다.
    if (intervalGrowthFactor < 0) {
      estimated = true;
      continue;
    }

    validIntervalCount += 1;
    growthFactor *= intervalGrowthFactor;
    estimated ||= interval.estimated;
  }

  const first = yearSnapshots[0];
  const last = yearSnapshots[yearSnapshots.length - 1];
  // 수익률과 순수익이 서로 다른 기간을 보면 카드에 "+10% / 순수익 -350원"처럼
  // 앞뒤가 안 맞는 값이 뜬다. 구간 판정 규칙을 그대로 재사용한다.
  const coveredFlows = yearFlows.filter((flow) => isFlowInInterval(flow, first, last));
  const netFlow = coveredFlows.reduce((sum, flow) => sum + flow.signedAmountKRW, 0);
  const coveredDepositsKRW = coveredFlows
    .filter((flow) => flow.type !== 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);
  const coveredWithdrawalsKRW = coveredFlows
    .filter((flow) => flow.type === 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);

  if (validIntervalCount === 0) {
    return {
      year: numericYear,
      status: 'insufficient',
      returnPercent: null,
      profitKRW: last.valueKRW - first.valueKRW - netFlow,
      depositsKRW: coveredDepositsKRW,
      withdrawalsKRW: coveredWithdrawalsKRW,
      startValueKRW: first.valueKRW,
      endValueKRW: last.valueKRW,
      startDate: first.date,
      endDate: last.date,
      snapshotCount: yearSnapshots.length,
      intervalCount: 0,
      openingSource: first.source || 'auto',
      carriedFrom: usedCarriedOpening ? carriedOpening.carriedFrom : '',
      estimated: usedCarriedOpening,
    };
  }

  return {
    year: numericYear,
    status: 'ready',
    returnPercent: (growthFactor - 1) * 100,
    profitKRW: last.valueKRW - first.valueKRW - netFlow,
    depositsKRW: coveredDepositsKRW,
    withdrawalsKRW: coveredWithdrawalsKRW,
    startValueKRW: first.valueKRW,
    endValueKRW: last.valueKRW,
    startDate: first.date,
    endDate: last.date,
    snapshotCount: yearSnapshots.length,
    intervalCount: validIntervalCount,
    openingSource: first.source || 'auto',
    // 이월로 만든 연초 평가액은 "그 사이 시세 변동 없음"을 가정한 값이라 추정으로 표시한다.
    carriedFrom: usedCarriedOpening ? carriedOpening.carriedFrom : '',
    estimated: estimated || usedCarriedOpening,
  };
};

export const upsertDailyPortfolioSnapshot = (snapshots = [], snapshot = {}) => {
  const date = toDateKey(snapshot.date);
  const valueKRW = Number(snapshot.valueKRW);
  if (!date || !Number.isFinite(valueKRW) || valueKRW < 0) return snapshots;

  const existing = snapshots.find((entry) => toDateKey(entry.date) === date);
  if (existing?.source === 'manual' && snapshot.source !== 'manual') return snapshots;
  if (existing?.source !== 'manual' && snapshot.source !== 'manual') return snapshots;
  if (
    existing
    && existing.valueKRW === valueKRW
    && (existing.source || 'auto') === (snapshot.source || 'auto')
  ) return snapshots;

  const nextSnapshot = {
    ...existing,
    ...snapshot,
    id: existing?.id || snapshot.id || `snapshot-${date}`,
    date,
    valueKRW,
    source: snapshot.source || 'auto',
  };
  const next = existing
    ? snapshots.map((entry) => (entry === existing ? nextSnapshot : entry))
    : [...snapshots, nextSnapshot];

  return next.sort((left, right) => toDateKey(left.date).localeCompare(toDateKey(right.date)));
};

export const getAnnualPerformanceYears = ({ snapshots = [], capitalFlows = [], currentYear } = {}) => {
  const years = new Set([Number(currentYear) || new Date().getFullYear()]);
  snapshots.forEach((snapshot) => {
    const year = Number(toDateKey(snapshot?.date).slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  });
  capitalFlows.forEach((flow) => {
    const year = Number(toDateKey(flow?.date).slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  });
  return [...years].sort((left, right) => right - left);
};
