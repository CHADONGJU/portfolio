import { isFormalTwrSnapshot } from './twrDatePolicy.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 0.000001;

const toDateKey = (value) => String(value || '').slice(0, 10);

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const enumerateDates = (startDate, endDate) => {
  const dates = [];
  for (let cursor = startDate; cursor && cursor <= endDate; cursor = shiftDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
};

const normalizeSnapshots = (snapshots, startDate) => {
  const byDate = new Map();
  snapshots.forEach((snapshot) => {
    const date = toDateKey(snapshot?.date);
    const valueKRW = Number(snapshot?.valueKRW);
    if (!DATE_PATTERN.test(date) || date < startDate || !Number.isFinite(valueKRW) || valueKRW < 0) return;
    if (!isFormalTwrSnapshot(snapshot)) return;
    byDate.set(date, { ...snapshot, date, valueKRW });
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

const normalizeFlowType = (flow) => String(flow?.type || flow?.normalizedType || '').toLowerCase();

const isDeposit = (flow) => ['deposit', 'transfer_in'].includes(normalizeFlowType(flow));
const isWithdrawal = (flow) => ['withdrawal', 'transfer_out'].includes(normalizeFlowType(flow));

const getFlowTimestamp = (flow) => {
  const explicit = flow?.timestamp || flow?.occurredAt || flow?.transactionTimestamp;
  const explicitTimestamp = Date.parse(String(explicit || ''));
  if (Number.isFinite(explicitTimestamp)) return explicitTimestamp;

  const date = toDateKey(flow?.date || flow?.transactionDate);
  const time = String(flow?.transactionTime || '').trim();
  if (!DATE_PATTERN.test(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return Number.NaN;
  return Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}+09:00`);
};

export const calculateDailyTwr = ({
  snapshots = [],
  cashFlows = [],
  twrAvailableFrom,
  // 레거시 호출 호환용이다. 새 코드는 twrAvailableFrom을 명시한다.
  performanceStartDate,
  performanceEndDate,
} = {}) => {
  const startDate = toDateKey(twrAvailableFrom || performanceStartDate);
  if (!DATE_PATTERN.test(startDate)) {
    return { status: 'insufficient', reason: 'twr-available-from-required', returnPercent: null };
  }

  const requestedEndDate = toDateKey(performanceEndDate);
  const hasRequestedEndDate = DATE_PATTERN.test(requestedEndDate) && requestedEndDate >= startDate;
  const validSnapshots = normalizeSnapshots(snapshots, startDate)
    .filter((snapshot) => !hasRequestedEndDate || snapshot.date <= requestedEndDate);
  if (validSnapshots.length === 0) {
    return {
      status: 'insufficient',
      reason: 'snapshot-required',
      returnPercent: null,
      startDate,
      endDate: '',
      missingSnapshotDates: [startDate],
    };
  }

  const endDate = hasRequestedEndDate ? requestedEndDate : validSnapshots.at(-1).date;
  const snapshotByDate = new Map(validSnapshots.map((snapshot) => [snapshot.date, snapshot]));
  const missingSnapshotDates = enumerateDates(startDate, endDate)
    .filter((date) => !snapshotByDate.has(date));
  if (missingSnapshotDates.length > 0) {
    return {
      status: 'insufficient',
      reason: 'daily-snapshot-missing',
      returnPercent: null,
      startDate,
      endDate,
      missingSnapshotDates,
    };
  }

  const baselineSnapshot = snapshotByDate.get(startDate);
  const baselineTimestamp = Date.parse(String(baselineSnapshot?.valuationTimestamp || ''));
  const firstReturnDate = validSnapshots[1]?.date || '';
  const relevantFlows = cashFlows
    .map((flow) => ({
      ...flow,
      date: toDateKey(flow?.date),
      amountKRW: flow?.amountKRW === null || flow?.amountKRW === undefined
        ? Number.NaN
        : Number(flow.amountKRW),
    }))
    .map((flow) => {
      if (flow.date !== startDate) return { ...flow, effectiveDate: flow.date };
      const flowTimestamp = getFlowTimestamp(flow);
      // EOD baseline과 같은 날짜 흐름은 이미 평가액에 포함된다. 다만 사용자가
      // intraday 초기 기준을 확정한 뒤 실제로 발생한 흐름은 다음 수익 구간에 이월한다.
      const occurredAfterBaseline = Number.isFinite(baselineTimestamp)
        && Number.isFinite(flowTimestamp)
        && flowTimestamp > baselineTimestamp;
      return {
        ...flow,
        effectiveDate: occurredAfterBaseline ? firstReturnDate : '',
      };
    })
    .filter((flow) => (
      flow.effectiveDate > startDate
      && flow.effectiveDate <= endDate
      && (isDeposit(flow) || isWithdrawal(flow))
    ));
  const unresolvedFxFlows = relevantFlows.filter((flow) => (
    !Number.isFinite(flow.amountKRW) || flow.amountKRW < 0 || flow.fxStatus === 'FX_RATE_MISSING'
  ));
  if (unresolvedFxFlows.length > 0) {
    return {
      status: 'insufficient',
      reason: 'fx-rate-missing',
      returnPercent: null,
      startDate,
      baselineDate: startDate,
      endDate,
      unresolvedFlowIds: unresolvedFxFlows.map((flow) => flow.id || flow.sourceHash || ''),
    };
  }

  const flowsByDate = relevantFlows.reduce((map, flow) => {
    if (!map.has(flow.effectiveDate)) map.set(flow.effectiveDate, []);
    map.get(flow.effectiveDate).push(flow);
    return map;
  }, new Map());
  const dailyReturns = [];
  let compounded = 1;

  for (let index = 1; index < validSnapshots.length; index += 1) {
    const previous = validSnapshots[index - 1];
    const current = validSnapshots[index];
    const flows = flowsByDate.get(current.date) || [];
    const depositsKRW = flows.filter(isDeposit).reduce((sum, flow) => sum + flow.amountKRW, 0);
    const withdrawalsKRW = flows.filter(isWithdrawal).reduce((sum, flow) => sum + flow.amountKRW, 0);
    const denominator = previous.valueKRW + depositsKRW;

    if (!(denominator > EPSILON)) {
      return {
        status: 'insufficient',
        reason: 'capital-base-required',
        returnPercent: null,
        startDate,
        endDate,
        failedDate: current.date,
      };
    }

    const rate = ((current.valueKRW + withdrawalsKRW) / denominator) - 1;
    compounded *= 1 + rate;
    dailyReturns.push({
      date: current.date,
      previousValueKRW: previous.valueKRW,
      valueKRW: current.valueKRW,
      depositsKRW,
      withdrawalsKRW,
      rate,
    });
  }

  if (dailyReturns.length === 0) {
    return {
      status: 'insufficient',
      reason: 'second-snapshot-required',
      returnPercent: null,
      startDate,
      endDate,
      missingSnapshotDates: [shiftDate(startDate, 1)],
    };
  }

  return {
    status: 'ready',
    reason: '',
    returnPercent: (compounded - 1) * 100,
    startDate,
    baselineDate: startDate,
    firstReturnDate: dailyReturns[0].date,
    endDate,
    dayCount: dailyReturns.length,
    snapshotCount: validSnapshots.length,
    dailyReturns,
    lastCashFlowDate: relevantFlows.map((flow) => flow.date).sort().at(-1) || '',
  };
};

/** 날짜 정책에서 확정한 시작일만 사용한다. Cash Flow 날짜로 시작점을 추론하지 않는다. */
export const calculateAvailableDailyTwr = ({
  accountInceptionDate,
  serviceJoinedAt,
  twrAvailableFrom,
  ...input
} = {}) => {
  const result = calculateDailyTwr({ ...input, twrAvailableFrom });
  const normalizedInceptionDate = toDateKey(accountInceptionDate);
  const normalizedServiceJoinedAt = toDateKey(serviceJoinedAt);
  const normalizedAvailableFrom = toDateKey(twrAvailableFrom);
  const fullAccountHistory = Boolean(
    DATE_PATTERN.test(normalizedInceptionDate)
    && DATE_PATTERN.test(normalizedAvailableFrom)
    && normalizedAvailableFrom <= normalizedInceptionDate,
  );
  return {
    ...result,
    accountInceptionDate: normalizedInceptionDate,
    serviceJoinedAt: normalizedServiceJoinedAt,
    twrAvailableFrom: normalizedAvailableFrom,
    coverageStatus: fullAccountHistory ? 'full' : 'partial',
    fullAccountHistory,
  };
};

const getKstDateKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

/** 연도별 화면도 총수익률과 동일한 Daily TWR 엔진만 사용한다. */
export const calculateAnnualDailyTwr = ({
  year,
  snapshots = [],
  cashFlows = [],
  dividends = [],
  twrAvailableFrom,
  serviceJoinedAt,
  accountInceptionDate,
  asOfDate = getKstDateKey(),
} = {}) => {
  const numericYear = Number(year);
  const availableFrom = toDateKey(twrAvailableFrom);
  const joinedAt = toDateKey(serviceJoinedAt);
  const yearStart = `${numericYear}-01-01`;
  const yearEnd = `${numericYear}-12-31`;
  const normalizedAsOfDate = DATE_PATTERN.test(toDateKey(asOfDate)) ? toDateKey(asOfDate) : getKstDateKey();

  if (!Number.isInteger(numericYear) || !DATE_PATTERN.test(availableFrom)) {
    return {
      year: numericYear,
      status: 'insufficient',
      reason: 'twr-available-from-required',
      returnPercent: null,
      periodType: 'insufficient',
      accountInceptionDate: toDateKey(accountInceptionDate),
      serviceJoinedAt: joinedAt,
      twrAvailableFrom: availableFrom,
    };
  }

  if (yearEnd < availableFrom || normalizedAsOfDate < availableFrom || normalizedAsOfDate < yearStart) {
    return {
      year: numericYear,
      status: 'insufficient',
      reason: 'before-twr-availability',
      returnPercent: null,
      periodType: 'insufficient',
      accountInceptionDate: toDateKey(accountInceptionDate),
      serviceJoinedAt: joinedAt,
      twrAvailableFrom: availableFrom,
    };
  }

  const previousYearEnd = shiftDate(yearStart, -1);
  const normalizedCompleteSnapshots = normalizeSnapshots(snapshots, previousYearEnd);
  const priorYearEodBaseline = normalizedCompleteSnapshots.find((snapshot) => (
    snapshot.date === previousYearEnd
  ));
  const explicitYearOpeningBaseline = normalizedCompleteSnapshots.find((snapshot) => (
    snapshot.date === yearStart
    && ['year-opening', 'bod'].includes(String(
      snapshot.valuationBasis || snapshot.valuationPoint || '',
    ).trim().toLowerCase())
  ));
  const openingBaseline = priorYearEodBaseline || explicitYearOpeningBaseline;
  const useExplicitYearOpening = Boolean(
    explicitYearOpeningBaseline && availableFrom === yearStart,
  );
  const isRecordedPartialYear = availableFrom >= yearStart && !useExplicitYearOpening;
  if (availableFrom < yearStart && !openingBaseline) {
    return {
      year: numericYear,
      status: 'insufficient',
      reason: 'annual-opening-baseline-required',
      returnPercent: null,
      periodType: 'insufficient',
      accountInceptionDate: toDateKey(accountInceptionDate),
      serviceJoinedAt: joinedAt,
      twrAvailableFrom: availableFrom,
      requiredBaselineDate: previousYearEnd,
    };
  }

  // 연도 중간에 기록이 시작된 해는 그 최초 EOD를 baseline으로 삼는 기록 구간이다.
  // 이미 이전 해부터 기록이 이어진 해는 직전 연도 EOD(또는 명시적 BOD)를 사용한다.
  const baselineDate = isRecordedPartialYear
    ? availableFrom
    : (openingBaseline?.date || availableFrom);
  const requestedEndDate = normalizedAsOfDate < yearEnd ? normalizedAsOfDate : yearEnd;
  const asOfYear = Number(normalizedAsOfDate.slice(0, 4));
  const latestCompleteDate = normalizedCompleteSnapshots
    .filter((snapshot) => snapshot.date >= baselineDate && snapshot.date <= requestedEndDate)
    .at(-1)?.date || '';
  // 진행 중인 연도는 오늘 장중 값이나 아직 생성되지 않은 오늘 EOD를 요구하지 않고
  // 마지막 COMPLETE Snapshot까지만 계산한다. 완료된 과거 연도는 12/31까지 필요하다.
  const endDate = numericYear === asOfYear && latestCompleteDate
    ? latestCompleteDate
    : requestedEndDate;
  const performance = calculateAvailableDailyTwr({
    snapshots,
    cashFlows,
    accountInceptionDate,
    serviceJoinedAt,
    twrAvailableFrom: baselineDate,
    performanceEndDate: endDate,
  });
  const dailyReturns = performance.dailyReturns || [];
  const depositsKRW = dailyReturns.reduce((sum, day) => sum + day.depositsKRW, 0);
  const withdrawalsKRW = dailyReturns.reduce((sum, day) => sum + day.withdrawalsKRW, 0);
  const startValueKRW = dailyReturns[0]?.previousValueKRW ?? null;
  const endValueKRW = dailyReturns.at(-1)?.valueKRW ?? null;
  const profitKRW = performance.status === 'ready'
    ? endValueKRW - startValueKRW - depositsKRW + withdrawalsKRW
    : null;
  const calculatedBaselineDate = performance.baselineDate || baselineDate;
  const calculatedStartDate = isRecordedPartialYear ? calculatedBaselineDate : yearStart;
  const calculatedEndDate = performance.endDate || endDate;
  const dividendsKRW = dividends
    .map((dividend) => ({ date: toDateKey(dividend?.date), amountKRW: Number(dividend?.amountKRW) || 0 }))
    .filter((dividend) => dividend.date > calculatedBaselineDate && dividend.date <= calculatedEndDate)
    .reduce((sum, dividend) => sum + dividend.amountKRW, 0);

  return {
    ...performance,
    year: numericYear,
    baselineDate: calculatedBaselineDate,
    startDate: calculatedStartDate,
    endDate: calculatedEndDate,
    depositsKRW,
    withdrawalsKRW,
    dividendsKRW,
    profitKRW,
    startValueKRW,
    endValueKRW,
    coverageStatus: isRecordedPartialYear ? 'partial' : 'full',
    periodType: isRecordedPartialYear ? 'recorded-period-twr' : 'calendar-year-twr',
    joinedAtAnchored: Boolean(joinedAt) && baselineDate === joinedAt,
    inferredStart: false,
    carriedForward: false,
    estimated: false,
  };
};

export const getAnnualTwrYears = ({
  accountInceptionDate,
  serviceJoinedAt,
  twrAvailableFrom,
  currentYear = new Date().getFullYear(),
} = {}) => {
  const numericCurrentYear = Number(currentYear);
  const firstKnownDate = [accountInceptionDate, twrAvailableFrom, serviceJoinedAt]
    .map(toDateKey)
    .filter((date) => DATE_PATTERN.test(date))
    .sort()
    .at(0) || '';
  const firstKnownYear = Number(firstKnownDate.slice(0, 4));
  const firstYear = Number.isInteger(firstKnownYear) && firstKnownYear <= numericCurrentYear
    ? firstKnownYear
    : numericCurrentYear;
  const years = [];
  for (let year = numericCurrentYear; year >= firstYear; year -= 1) years.push(year);
  return years;
};
