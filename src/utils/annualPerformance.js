const EPSILON = 1e-8;

const toDateKey = (value) => String(value || '').slice(0, 10);

/**
 * 같은 날짜 기록이 둘 이상일 때 어느 것을 쓸지.
 * 로컬 저장분과 클라우드 저장분이 합쳐지는 순서는 로그인/동기화 타이밍에 따라
 * 매번 달라질 수 있는데, "배열에서 마지막 것"을 쓰면 새로고침할 때마다 기준값이
 * 바뀌어 수익률이 흔들린다. 출처에 명시적인 우선순위를 두어 순서와 무관하게 늘
 * 같은 값을 고른다.
 */
const SNAPSHOT_SOURCE_PRIORITY = {
  current: 4,
  manual: 3,
  auto: 2,
  'carried-forward': 1,
  inception: 0,
};

const getSnapshotPriority = (snapshot = {}) => (
  SNAPSHOT_SOURCE_PRIORITY[snapshot.source] ?? 2
);

const normalizeSnapshots = (snapshots = [], year) => {
  const byDate = new Map();

  snapshots.forEach((snapshot) => {
    const date = toDateKey(snapshot?.date);
    const valueKRW = Number(snapshot?.valueKRW);
    if (!date.startsWith(`${year}-`) || !Number.isFinite(valueKRW) || valueKRW < 0) return;
    const candidate = { ...snapshot, date, valueKRW };
    const existing = byDate.get(date);
    if (existing && getSnapshotPriority(existing) > getSnapshotPriority(candidate)) return;
    byDate.set(date, candidate);
  });

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

/**
 * 스냅샷이 "그날 언제의 값"인지.
 * - 이월값, 가입일 추정(0원)은 그날 활동 전(=하루의 시작) 값이다. 그래서 그날
 *   입금은 아직 안 들어가 있고, 다음 구간의 원금으로 쳐야 한다.
 * - 자동 저장·현재 값은 그 순간까지의 활동이 이미 반영된 값이다(그 돈으로 바로
 *   매수했다면 이미 자산에 잡혀 있음).
 * 이 구분을 놓치면 경계일의 입출금이 두 번 잡히거나 통째로 빠진다.
 */
const isDayOpenSnapshot = (snapshot = {}) => (
  snapshot.source === 'carried-forward' || snapshot.source === 'inception'
);

const normalizeFlow = (flow) => {
  const date = toDateKey(flow?.date);
  const amountKRW = Math.abs(Number(flow?.amountKRW) || 0);
  const signedAmountKRW = flow?.type === 'withdrawal' ? -amountKRW : amountKRW;
  return { ...flow, date, amountKRW, signedAmountKRW };
};

const normalizeAllFlows = (capitalFlows = []) => capitalFlows
  .map(normalizeFlow)
  .filter((flow) => flow.date && flow.amountKRW > 0)
  .sort((left, right) => left.date.localeCompare(right.date));

// 배당은 항상 양수다(받은 적 없는 배당을 음수로 뺄 일이 없다).
const normalizeDividends = (dividends = []) => dividends
  .map((dividend) => ({ ...dividend, date: toDateKey(dividend?.date), amountKRW: Number(dividend?.amountKRW) || 0 }))
  .filter((dividend) => dividend.date && dividend.amountKRW > 0)
  .sort((left, right) => left.date.localeCompare(right.date));

// 실현손익은 이익(+)도 손실(-)도 될 수 있다. 0보다 커야 한다는 필터를 배당과
// 같이 쓰면 손실 매도가 통째로 사라져 수익률이 실제보다 부풀려진다.
const normalizeRealizedGains = (events = []) => events
  .map((event) => ({ ...event, date: toDateKey(event?.date), amountKRW: Number(event?.amountKRW) || 0 }))
  .filter((event) => event.date && Number.isFinite(event.amountKRW) && event.amountKRW !== 0)
  .sort((left, right) => left.date.localeCompare(right.date));

/**
 * 이 이벤트(입출금·배당·실현손익)가 [start, end] 구간에 속하는지. 하루의 시작 값과
 * 끝 값을 구분해 경계일 이벤트를 정확히 한 구간에만 넣는다.
 */
const isEventInInterval = (eventDate, start, end) => {
  const afterStart = isDayOpenSnapshot(start) ? eventDate >= start.date : eventDate > start.date;
  const beforeEnd = isDayOpenSnapshot(end) ? eventDate < end.date : eventDate <= end.date;
  return afterStart && beforeEnd;
};

/**
 * 연초 평가액 이월.
 *
 * 올해 안에 1월 1일 평가액이 없으면, 직전 해의 마지막 평가액을 가져와 그 뒤
 * 연말까지의 입출금만 더해 1월 1일 시작값(=원금 기준점)으로 삼는다. 너무 오래된
 * 평가액을 끌어오면 지난 몇 년치 원금이 통째로 올해 것이 되므로, 직전 해 11월
 * 이후 기록만 이월 대상으로 본다. 평가손익(미실현)은 판 게 아니면 그 사이 시세
 * 변동이 없었다고 가정하고 그대로 이어받는다(estimated로 표시).
 */
const buildCarriedOpeningSnapshot = (snapshots = [], allFlows = [], year) => {
  const openingDate = `${year}-01-01`;
  const earliestCarryDate = `${year - 1}-11-01`;

  const candidates = new Map();
  snapshots.forEach((snapshot) => {
    const date = toDateKey(snapshot?.date);
    const valueKRW = Number(snapshot?.valueKRW);
    if (!date || date < earliestCarryDate || date >= openingDate) return;
    if (!Number.isFinite(valueKRW) || valueKRW < 0) return;

    const candidate = {
      date,
      valueKRW,
      source: snapshot.source || 'auto',
      unrealizedProfitKRW: snapshot.unrealizedProfitKRW,
    };
    const existing = candidates.get(date);
    if (existing && getSnapshotPriority(existing) > getSnapshotPriority(candidate)) return;
    candidates.set(date, candidate);
  });

  const previous = [...candidates.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-1)[0];

  if (!previous) return null;

  const previousOpensDay = isDayOpenSnapshot(previous);
  const gapFlow = allFlows
    .filter((flow) => (
      (previousOpensDay ? flow.date >= previous.date : flow.date > previous.date)
      && flow.date < openingDate
    ))
    .reduce((sum, flow) => sum + flow.signedAmountKRW, 0);

  const valueKRW = previous.valueKRW + gapFlow;
  if (!(valueKRW >= 0)) return null;

  return {
    id: `carried-forward-${year}`,
    date: openingDate,
    valueKRW,
    unrealizedProfitKRW: previous.unrealizedProfitKRW,
    source: 'carried-forward',
    asOfDate: previous.date,
  };
};

/**
 * 연 순수익 = 그 해에 "판" 손익(실현손익) + 그 해에 받은 배당 + 그 해 동안의
 * 미실현손익(아직 안 판 것들의 평가손익) 변화.
 *
 * 예전 방식(연초 평가금액 대비 연말 평가금액의 변화)은 종목을 팔면 그 평가금액이
 * 보유 목록에서 통째로 사라지는데, 판 돈을 현금으로 따로 추적하지 않는 한 그 사실을
 * 되돌려 넣을 방법이 없어 "이익을 보고 팔아도 손실처럼 보이는" 문제가 있었다.
 * 실현손익·배당·미실현손익을 각각 자기 방식대로(트레이드 기록/배당 기록/평가손익
 * 기록) 따로 더하면, 판 돈이 어디로 갔는지(현금으로 잡았는지, 재투자했는지)와
 * 무관하게 항상 맞는 값이 나온다.
 *
 * 구간은 언제나 그 해 1월 1일부터다. 기록을 8월에 시작했다고 해서 "8/25~오늘"
 * 같은 며칠짜리 구간으로 좁히면, 며칠 사이의 평가손익이 몇 달치 원금으로 나뉘어
 * 수십 %가 튀어나온다. 연초 기준값이 없으면 그 자리를 0원으로 두고, 대신 나눌
 * 원금은 실제 매입원가로 잡는다 — 그래야 "1월 1일부터"라는 말과 화면의 숫자가
 * 같은 뜻이 된다.
 */
export const calculateAnnualPerformance = ({
  snapshots = [], capitalFlows = [], dividends = [], realizedGains = [],
  year, costBasisKRW = 0,
} = {}) => {
  const numericYear = Number(year);
  const yearStartKey = `${numericYear}-01-01`;
  const ownSnapshots = normalizeSnapshots(snapshots, numericYear);
  const allFlows = normalizeAllFlows(capitalFlows);
  const allDividends = normalizeDividends(dividends);
  const allRealizedGains = normalizeRealizedGains(realizedGains);
  const yearFlows = allFlows.filter((flow) => flow.date.startsWith(`${numericYear}-`));
  const depositsKRW = yearFlows
    .filter((flow) => flow.type !== 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);
  const withdrawalsKRW = yearFlows
    .filter((flow) => flow.type === 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);

  // 1월 1일 기준값은 우선순위대로 정한다:
  //   1) 이미 정확히 1월 1일자로 기록된 실제 평가액이 있으면 그대로 쓴다.
  //   2) 없으면 전년도 마지막 실제 평가액(그 뒤 연말까지 입출금 반영)을 이어받는다.
  //   3) 그것도 없으면 1월 1일을 0원으로 둔다. 이땐 "연초 기준값이 아직 없다"는
  //      뜻이므로, 나눌 원금은 아래에서 실제로 관측된 값으로 따로 정한다.
  //      앱 가입일은 근거로 쓰지 않는다 — 가입일은 이 앱에 등록한 날일 뿐이고,
  //      그 전부터 굴리던 계좌였을 수 있어서 "그 해에 생긴 계좌"라고 단정하면
  //      기존 원금이 통째로 수익으로 잡힌다.
  const hasExplicitYearStart = ownSnapshots[0]?.date === yearStartKey;
  const carriedForwardSnapshot = hasExplicitYearStart
    ? null
    : buildCarriedOpeningSnapshot(snapshots, allFlows, numericYear);
  const assumedOpeningSnapshot = (!hasExplicitYearStart && !carriedForwardSnapshot)
    ? { id: `year-start-${numericYear}`, date: yearStartKey, valueKRW: 0, unrealizedProfitKRW: 0, source: 'inception' }
    : null;

  const baseStartSnapshot = carriedForwardSnapshot || assumedOpeningSnapshot;
  const yearSnapshots = baseStartSnapshot ? [baseStartSnapshot, ...ownSnapshots] : ownSnapshots;
  const openingBasis = hasExplicitYearStart
    ? 'recorded'
    : carriedForwardSnapshot
      ? 'carried-forward'
      : 'assumed-zero';

  if (yearSnapshots.length < 2) {
    return {
      year: numericYear,
      status: 'insufficient',
      returnPercent: null,
      profitKRW: null,
      depositsKRW,
      withdrawalsKRW,
      startDate: yearStartKey,
      endDate: ownSnapshots[0]?.date || '',
      snapshotCount: ownSnapshots.length,
      estimated: false,
      periodType: 'insufficient',
      openingBasis,
      capitalBasis: 'none',
      carriedForward: false,
      reason: 'current-value-required',
    };
  }

  const first = yearSnapshots[0];
  const last = yearSnapshots[yearSnapshots.length - 1];

  const coveredFlows = allFlows.filter((flow) => isEventInInterval(flow.date, first, last));
  const netFlow = coveredFlows.reduce((sum, flow) => sum + flow.signedAmountKRW, 0);
  const coveredDepositsKRW = coveredFlows
    .filter((flow) => flow.type !== 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);
  const coveredWithdrawalsKRW = coveredFlows
    .filter((flow) => flow.type === 'withdrawal')
    .reduce((sum, flow) => sum + flow.amountKRW, 0);
  // 배당·실현손익은 마지막 평가 스냅샷 이후에도 연말까지는 여전히 "이 해"의 몫이다.
  // last를 그대로 쓰면 마지막 스냅샷 뒤~12/31 사이에 받은 배당/판 손익이 이 해에도,
  // (이월은 평가금액만 이어받으므로) 다음 해에도 잡히지 않고 통째로 사라진다.
  // 입출금은 이 확장을 적용하지 않는다 — 그 몫은 이미 이월(gapFlow)이 다음 해
  // 원금에 반영하므로, 여기서도 넣으면 두 해에 중복으로 잡힌다.
  const yearEndKey = `${numericYear}-12-31`;
  const eventWindowEnd = last.date < yearEndKey ? { date: yearEndKey, source: last.source } : last;
  const coveredDividendsKRW = allDividends
    .filter((dividend) => isEventInInterval(dividend.date, first, eventWindowEnd))
    .reduce((sum, dividend) => sum + dividend.amountKRW, 0);
  const coveredRealizedGainsKRW = allRealizedGains
    .filter((gain) => isEventInInterval(gain.date, first, eventWindowEnd))
    .reduce((sum, gain) => sum + gain.amountKRW, 0);

  const startUnrealizedRaw = Number(first.unrealizedProfitKRW);
  const endUnrealizedRaw = Number(last.unrealizedProfitKRW);
  // 미실현손익을 스냅샷에 저장하기 전 데이터는 그 시점 값을 알 수 없다. 없는 데이터를
  // 지어내는 대신 0으로 근사하고 estimated로 남긴다.
  const unrealizedBaselineMissing = !Number.isFinite(startUnrealizedRaw) || !Number.isFinite(endUnrealizedRaw);
  const startUnrealizedKRW = Number.isFinite(startUnrealizedRaw) ? startUnrealizedRaw : 0;
  const endUnrealizedKRW = Number.isFinite(endUnrealizedRaw) ? endUnrealizedRaw : 0;
  const unrealizedChangeKRW = endUnrealizedKRW - startUnrealizedKRW;

  const profitKRW = unrealizedChangeKRW + coveredRealizedGainsKRW + coveredDividendsKRW;

  // 끝점 평가손익도 없고 그 해에 판 것도 받은 배당도 없으면 수익을 잴 근거가 하나도
  // 없다. 그걸 0원 수익(=0%)으로 적어 내면 "아무 일도 없었다"가 아니라 "정확히
  // 본전이었다"는 거짓말이 된다.
  const endUnrealizedMissing = !Number.isFinite(endUnrealizedRaw);
  const hasProfitEvidence = !endUnrealizedMissing
    || coveredRealizedGainsKRW !== 0
    || coveredDividendsKRW !== 0;

  /**
   * 나눌 원금.
   * 연초 기준값이 실제로 있으면 "연초 평가액 + 그 해 순입금"이 정확한 기준이다.
   * 연초 기준값이 없어 0원으로 뒀다면 그 해 입금만으로는 원금을 다 설명하지 못한다
   * (작년까지 넣어둔 돈이 통째로 빠진다). 그럴 땐 실제 매입원가를 원금으로 본다 —
   * 없는 과거 평가액을 지어내는 대신, 지금 들고 있는 것들에 실제로 들어간 돈으로
   * 나눈다. 매입원가도 모르면 그 해 첫 평가액이라도 쓴다.
   */
  const flowBasedCapitalKRW = first.valueKRW + netFlow;
  const normalizedCostBasisKRW = Number(costBasisKRW);
  const usableCostBasisKRW = Number.isFinite(normalizedCostBasisKRW) && normalizedCostBasisKRW > EPSILON
    ? normalizedCostBasisKRW
    : 0;
  // 그 해에 처음 찍힌 실제 평가액도 원금 후보다. 그 값에는 작년까지 넣어둔 돈이
  // 이미 들어 있어서, 올해 입금만 세는 것보다 원금을 덜 놓친다. 다만 평가액에는
  // 그때까지 쌓인 평가이익도 섞여 있으므로 그만큼은 빼야 원금이 된다 — 안 그러면
  // 이익이 원금 행세를 해서 수익률이 실제보다 낮게 나온다.
  const firstOwnSnapshot = ownSnapshots[0];
  const firstOwnUnrealizedKRW = Number(firstOwnSnapshot?.unrealizedProfitKRW);
  const snapshotBasedCapitalKRW = firstOwnSnapshot
    ? firstOwnSnapshot.valueKRW
      - (Number.isFinite(firstOwnUnrealizedKRW) ? firstOwnUnrealizedKRW : 0)
      + allFlows
        .filter((flow) => flow.date > firstOwnSnapshot.date && flow.date <= last.date)
        .reduce((sum, flow) => sum + flow.signedAmountKRW, 0)
    : 0;

  let denominatorKRW = flowBasedCapitalKRW;
  let capitalBasis = 'opening-plus-flows';
  if (assumedOpeningSnapshot) {
    /**
     * 연초 기준값이 없으면 "0원 + 그 해 순입금"은 원금이 아니다.
     * 입출금 기록은 이 앱을 쓰기 시작한 뒤부터만 온전한 경우가 많고, 한 해 동안
     * 넣었다 뺐다를 반복하면 누적 순입금이 실제로 굴린 돈과 한참 벌어진다
     * (5백만 원을 굴리는 계좌의 올해 누적 입금이 6천만 원이 되는 식이다).
     * 그래서 계좌가 실제로 갖고 있던 값 — 그 해 첫 평가액(그때까지의 평가이익은
     * 빼고, 그 뒤 입출금은 더해서)과 지금 보유분의 매입원가 — 중 큰 쪽을 쓴다.
     */
    const observedCapitalKRW = Math.max(snapshotBasedCapitalKRW, usableCostBasisKRW);
    if (observedCapitalKRW > EPSILON) {
      denominatorKRW = observedCapitalKRW;
      capitalBasis = observedCapitalKRW === usableCostBasisKRW
        ? 'cost-basis'
        : 'first-snapshot';
    }
  }
  if (!(denominatorKRW > EPSILON) && usableCostBasisKRW > EPSILON) {
    denominatorKRW = usableCostBasisKRW;
    capitalBasis = 'cost-basis';
  }
  if (!(denominatorKRW > EPSILON) && snapshotBasedCapitalKRW > EPSILON) {
    denominatorKRW = snapshotBasedCapitalKRW;
    capitalBasis = 'first-snapshot';
  }

  const hasMidPeriodFlow = coveredFlows.some((flow) => flow.date > first.date && flow.date < last.date);
  const estimated = Boolean(carriedForwardSnapshot)
    || unrealizedBaselineMissing
    || hasMidPeriodFlow
    || openingBasis === 'assumed-zero';

  const sharedFields = {
    year: numericYear,
    depositsKRW: coveredDepositsKRW,
    withdrawalsKRW: coveredWithdrawalsKRW,
    dividendsKRW: coveredDividendsKRW,
    realizedGainsKRW: coveredRealizedGainsKRW,
    unrealizedChangeKRW,
    startValueKRW: first.valueKRW,
    endValueKRW: last.valueKRW,
    capitalBaseKRW: denominatorKRW,
    startDate: first.date,
    endDate: last.date,
    snapshotCount: ownSnapshots.length,
    openingBasis,
    capitalBasis,
    carriedForward: Boolean(carriedForwardSnapshot),
    carriedForwardAsOfDate: carriedForwardSnapshot?.asOfDate || '',
    carriedForwardValueKRW: carriedForwardSnapshot ? carriedForwardSnapshot.valueKRW : null,
  };

  // 원금 기준점이 0이거나 음수면(투자 원금 자체가 없거나, 원금보다 큰 출금으로
  // 기준이 깨진 경우) 나눌 대상이 없어 퍼센트를 만들 수 없다 — 순수익이 0이라고
  // 해서 0%로 얼버무리면, "투자한 적이 없는 계좌"와 "투자해서 정확히 0% 낸 계좌"를
  // 구분하지 못하게 된다.
  if (!hasProfitEvidence || !(denominatorKRW > EPSILON)) {
    return {
      ...sharedFields,
      status: 'insufficient',
      returnPercent: null,
      profitKRW: hasProfitEvidence ? profitKRW : null,
      estimated: true,
      periodType: 'insufficient',
      capitalBasis: 'none',
      reason: hasProfitEvidence ? 'capital-base-required' : 'current-value-required',
    };
  }

  return {
    ...sharedFields,
    status: 'ready',
    returnPercent: (profitKRW / denominatorKRW) * 100,
    profitKRW,
    estimated,
    periodType: 'calendar-year',
  };
};

export const upsertDailyPortfolioSnapshot = (snapshots = [], snapshot = {}) => {
  const date = toDateKey(snapshot.date);
  const valueKRW = Number(snapshot.valueKRW);
  if (!date || !Number.isFinite(valueKRW) || valueKRW < 0) return snapshots;

  // 하루 한 번만 저장한다 — 그날 값이 아예 없을 때만 새로 만든다.
  const hasExisting = snapshots.some((entry) => toDateKey(entry.date) === date);
  if (hasExisting) return snapshots;

  const nextSnapshot = {
    ...snapshot,
    id: snapshot.id || `snapshot-${date}`,
    date,
    valueKRW,
    source: snapshot.source || 'auto',
  };

  return [...snapshots, nextSnapshot].sort((left, right) => toDateKey(left.date).localeCompare(toDateKey(right.date)));
};

/**
 * 수익률 화면은 오늘의 자동 스냅샷이 아직 영구 저장되지 않았더라도 현재 총평가액으로
 * 즉시 계산해야 한다.
 */
export const withCurrentPortfolioSnapshot = (snapshots = [], snapshot = {}) => {
  const date = toDateKey(snapshot.date);
  const valueKRW = Number(snapshot.valueKRW);
  if (!date || !Number.isFinite(valueKRW) || valueKRW < 0) return snapshots;

  const existing = snapshots.find((entry) => toDateKey(entry.date) === date);

  const current = {
    ...existing,
    ...snapshot,
    id: existing?.id || snapshot.id || `snapshot-${date}`,
    date,
    valueKRW,
    source: 'current',
  };

  return (existing
    ? snapshots.map((entry) => (entry === existing ? current : entry))
    : [...snapshots, current]
  ).sort((left, right) => toDateKey(left.date).localeCompare(toDateKey(right.date)));
};

export const summarizeCapitalFlows = (capitalFlows = []) => capitalFlows.reduce((summary, flow) => {
  const amountKRW = Math.abs(Number(flow?.amountKRW) || 0);
  if (flow?.type === 'withdrawal') summary.withdrawalsKRW += amountKRW;
  else summary.depositsKRW += amountKRW;
  summary.netPrincipalKRW = summary.depositsKRW - summary.withdrawalsKRW;
  return summary;
}, { depositsKRW: 0, withdrawalsKRW: 0, netPrincipalKRW: 0 });

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
