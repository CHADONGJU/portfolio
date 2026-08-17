const DAY_MS = 24 * 60 * 60 * 1000;

const toDateKey = (value) => String(value || '').slice(0, 10);

const getTime = (value) => {
  const time = new Date(`${toDateKey(value)}T00:00:00`).getTime();
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

const normalizeFlows = (capitalFlows = [], year) => capitalFlows
  .map((flow) => {
    const date = toDateKey(flow?.date);
    const amountKRW = Math.abs(Number(flow?.amountKRW) || 0);
    const signedAmountKRW = flow?.type === 'withdrawal' ? -amountKRW : amountKRW;
    return { ...flow, date, amountKRW, signedAmountKRW };
  })
  .filter((flow) => flow.date.startsWith(`${year}-`) && flow.amountKRW > 0)
  .sort((left, right) => left.date.localeCompare(right.date));

const calculateIntervalReturn = (start, end, flows) => {
  const startTime = getTime(start.date);
  const endTime = getTime(end.date);
  const intervalDays = Math.max(1, (endTime - startTime) / DAY_MS);
  const netFlow = flows.reduce((sum, flow) => sum + flow.signedAmountKRW, 0);
  const weightedFlow = flows.reduce((sum, flow) => {
    const flowTime = getTime(flow.date);
    const remainingWeight = Math.max(0, Math.min(1, (endTime - flowTime) / (endTime - startTime || DAY_MS)));
    return sum + flow.signedAmountKRW * remainingWeight;
  }, 0);
  const denominator = start.valueKRW + weightedFlow;

  if (!(denominator > 0)) return null;

  return {
    returnRate: (end.valueKRW - start.valueKRW - netFlow) / denominator,
    netFlow,
    estimated: intervalDays > 3 && flows.length > 0,
  };
};

export const calculateAnnualPerformance = ({ snapshots = [], capitalFlows = [], year } = {}) => {
  const numericYear = Number(year);
  const yearSnapshots = normalizeSnapshots(snapshots, numericYear);
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
      estimated: false,
    };
  }

  let growthFactor = 1;
  let estimated = false;

  for (let index = 1; index < yearSnapshots.length; index += 1) {
    const start = yearSnapshots[index - 1];
    const end = yearSnapshots[index];
    const intervalFlows = yearFlows.filter((flow) => (
      flow.date <= end.date && (index === 1 ? flow.date >= start.date : flow.date > start.date)
    ));
    const interval = calculateIntervalReturn(start, end, intervalFlows);
    if (!interval) continue;
    growthFactor *= 1 + interval.returnRate;
    estimated ||= interval.estimated;
  }

  const first = yearSnapshots[0];
  const last = yearSnapshots[yearSnapshots.length - 1];
  const coveredFlows = yearFlows.filter((flow) => flow.date >= first.date && flow.date <= last.date);
  const netFlow = coveredFlows.reduce((sum, flow) => sum + flow.signedAmountKRW, 0);
  const coveredDepositsKRW = coveredFlows
    .filter((flow) => flow.type !== 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);
  const coveredWithdrawalsKRW = coveredFlows
    .filter((flow) => flow.type === 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);

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
    estimated,
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
