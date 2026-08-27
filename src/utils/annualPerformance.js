const EPSILON = 1e-8;

const toDateKey = (value) => String(value || '').slice(0, 10);

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
 * - 사용자가 넣은 연초 평가액, 이월값, 가입일 추정(0원)은 그날 활동 전(=하루의 시작)
 *   값이다. 그래서 그날 입금은 아직 안 들어가 있고, 다음 구간의 원금으로 쳐야 한다.
 * - 자동 저장·현재 값은 그 순간까지의 활동이 이미 반영된 값이다(그 돈으로 바로
 *   매수했다면 이미 자산에 잡혀 있음).
 * 이 구분을 놓치면 경계일의 입출금이 두 번 잡히거나 통째로 빠진다.
 */
const isDayOpenSnapshot = (snapshot = {}) => (
  snapshot.source === 'manual' || snapshot.source === 'carried-forward' || snapshot.source === 'inception'
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

    // normalizeSnapshots와 같은 규칙: 같은 날짜면 사용자가 넣은 값이 이긴다.
    const existing = candidates.get(date);
    if (!existing || snapshot.source === 'manual' || existing.source !== 'manual') {
      candidates.set(date, {
        date,
        valueKRW,
        source: snapshot.source || 'auto',
        unrealizedProfitKRW: snapshot.unrealizedProfitKRW,
      });
    }
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
 * 다만 미실현손익은 "그 해 1월 1일 기준 얼마였는지"를 알아야 그 해의 변화를 알 수
 * 있는데, 이 값을 스냅샷에 저장하기 시작한 시점 이전 데이터는 알 수 없다 — 그런
 * 경우 0에서 시작했다고 근사하고 estimated로 표시한다(있는 데이터를 지어내지
 * 않는다는 원칙은 지키되, 완전히 계산을 막지는 않는다).
 */
export const calculateAnnualPerformance = ({
  snapshots = [], capitalFlows = [], dividends = [], realizedGains = [], year, joinedAt = null,
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

  // 원금 기준점은 우선순위대로 정한다:
  //   1) 사용자가 직접 입력한 연초 평가액
  //   2) 전년도 마지막 실제 평가액(그 뒤 연말까지 입출금 반영) 이어받기
  //   3) 둘 다 없으면 "가입일"을 0원 시작점으로 보고 그 날부터 지금까지를 하나의
  //      구간으로 계산한다. 가입 이전 포트폴리오가 있었다고 가정하지 않고, 그 해
  //      1월 1일 자산이 얼마였는지 기억해서 입력하라고 요구하지도 않는다.
  //      가입일을 모르면(마이그레이션 이전 데이터) 최초 입출금일로 대신하되, 이때도
  //      존재하지 않는 과거 평가액을 새로 만들어내지는 않는다.
  const hasExplicitYearStart = ownSnapshots[0]?.date === yearStartKey;
  const carriedForwardSnapshot = (!hasExplicitYearStart && ownSnapshots.length > 0)
    ? buildCarriedOpeningSnapshot(snapshots, allFlows, numericYear)
    : null;

  const joinedAtKey = toDateKey(joinedAt) || null;
  const globalFirstFlow = allFlows[0];
  const earliestFlowDate = globalFirstFlow ? globalFirstFlow.date : null;
  // 가입일을 모르는 상태에서 근거가 "첫 기록이 출금"뿐이면, 그 이전 잔액을 알 수 없으니
  // 0원 시작을 추론하지 않는다(가입일이 있으면 가입 시점이 0원이라는 걸 이미 알기 때문에 무관하다).
  const anchorFromWithdrawalOnly = !joinedAtKey && globalFirstFlow?.type === 'withdrawal';
  const inceptionCandidateDate = (!hasExplicitYearStart && !carriedForwardSnapshot && !anchorFromWithdrawalOnly)
    ? [joinedAtKey, earliestFlowDate].filter(Boolean).sort()[0] || null
    : null;
  // 올해 실제 평가액이 이미 2건 이상이면 그 자체로 체이닝할 수 있으니 가입일 0원을
  // 끼워 넣지 않는다 — 끼워 넣으면 "0원 → 첫 실제값" 구간이 그 실제값에 이미 반영된
  // 입금을 다시 수익으로 잡아 이중 계산한다. 실제 평가액이 하나도 없거나 딱 하나뿐일
  // 때만(체이닝할 짝이 없을 때만) 가입일을 대신 두 번째 기준점으로 쓴다. 이때도 가입일
  // 추정이 그 하나뿐인 실제 기록보다 뒤라면 순서가 뒤집히므로 쓰지 않는다.
  // 그리고 가입일~올해 사이의 다른 해에 이미 실제 평가액이 있었다면, 그 해가 이
  // 기간의 일부를 이미 소유하고 있다는 뜻이라 올해가 가입일까지 통째로 다시 끌어오면
  // 그 사이 입출금이 두 해의 카드에 똑같이 중복으로 잡힌다. 그럴 땐 이월할 수
  // 없는 진짜 자료 부족으로 본다(가짜 값을 만들어내지 않는다).
  const hasEarlierYearOwnSnapshot = inceptionCandidateDate && snapshots.some((snapshot) => {
    const date = toDateKey(snapshot?.date);
    const valueKRW = Number(snapshot?.valueKRW);
    return date && Number.isFinite(valueKRW) && valueKRW >= 0
      && date >= inceptionCandidateDate && date < yearStartKey;
  });
  const inceptionAnchorDate = inceptionCandidateDate
    && ownSnapshots.length < 2
    && (ownSnapshots.length === 0 || inceptionCandidateDate <= ownSnapshots[0].date)
    && !hasEarlierYearOwnSnapshot
    ? inceptionCandidateDate
    : null;
  const inceptionSnapshot = inceptionAnchorDate
    ? { id: 'inception', date: inceptionAnchorDate, valueKRW: 0, unrealizedProfitKRW: 0, source: 'inception' }
    : null;

  // 가입일 자체가 이 해 안이면 그 해 1월 1일 자산이 0원이었다는 건 추측이 아니라
  // 사실이다(그 계좌는 아직 존재하지도 않았다). 그럴 땐 기록을 시작한 날이 아니라
  // 1월 1일을 시작점으로 잡아, 카드가 "8/25 ~ 오늘" 같은 며칠짜리 구간이 아니라 그
  // 해 전체(올해라면 1/1 ~ 오늘)를 보여주게 한다. 기준값이 0원이라 그 뒤의 입금이
  // 그대로 원금이 되고, 첫 스냅샷 이전에 난 수익도 빠지지 않는다.
  // 가입일을 모르면(마이그레이션 이전 데이터) 이 추론을 쓰지 않는다 — 기록 시작
  // 이전부터 굴리던 자산이 있었을 수 있고, 그러면 그 원금이 통째로 수익으로 잡힌다.
  const hasRecordBeforeYear = Boolean(joinedAtKey && joinedAtKey < yearStartKey)
    || allFlows.some((flow) => flow.date < yearStartKey)
    || snapshots.some((snapshot) => {
      const date = toDateKey(snapshot?.date);
      const valueKRW = Number(snapshot?.valueKRW);
      return Boolean(date) && date < yearStartKey && Number.isFinite(valueKRW) && valueKRW >= 0;
    });
  const lastOwnSnapshot = ownSnapshots[ownSnapshots.length - 1];
  // 1월 1일 0원을 기준으로 쓰려면 그 뒤에 실제로 들어온 원금이 있어야 한다. 순입금이
  // 0 이하면 나눌 원금이 없어 오히려 계산이 막히므로, 그럴 땐 기존 방식을 그대로 둔다.
  const netFlowSinceYearStart = allFlows
    .filter((flow) => flow.date >= yearStartKey && (!lastOwnSnapshot || flow.date <= lastOwnSnapshot.date))
    .reduce((sum, flow) => sum + flow.signedAmountKRW, 0);
  const yearStartZeroSnapshot = (
    !hasExplicitYearStart
    && !carriedForwardSnapshot
    && !inceptionSnapshot
    && !anchorFromWithdrawalOnly
    && !hasRecordBeforeYear
    && Boolean(joinedAtKey)
    && Boolean(lastOwnSnapshot)
    && lastOwnSnapshot.date > yearStartKey
    && netFlowSinceYearStart > EPSILON
  )
    ? { id: `year-start-${numericYear}`, date: yearStartKey, valueKRW: 0, unrealizedProfitKRW: 0, source: 'inception' }
    : null;

  const baseStartSnapshot = hasExplicitYearStart
    ? null
    : (carriedForwardSnapshot || yearStartZeroSnapshot || inceptionSnapshot);
  const usedInceptionSnapshot = baseStartSnapshot === inceptionSnapshot ? inceptionSnapshot : null;
  const yearSnapshots = baseStartSnapshot ? [baseStartSnapshot, ...ownSnapshots] : ownSnapshots;
  const joinedAtAnchored = Boolean(usedInceptionSnapshot) && usedInceptionSnapshot.date === joinedAtKey;

  if (yearSnapshots.length < 2) {
    return {
      year: numericYear,
      status: 'insufficient',
      returnPercent: null,
      profitKRW: null,
      depositsKRW,
      withdrawalsKRW,
      startDate: ownSnapshots[0]?.date || '',
      endDate: ownSnapshots[0]?.date || '',
      snapshotCount: ownSnapshots.length,
      estimated: false,
      periodType: 'insufficient',
      inferredStart: false,
      joinedAtAnchored: false,
      carriedForward: false,
      reason: anchorFromWithdrawalOnly
        ? 'opening-value-required'
        : !inceptionAnchorDate && !carriedForwardSnapshot
          ? 'cash-flow-required'
          : 'current-value-required',
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
  // 원금 기준점 + 그 기간의 순입금. 입금 시점별 가중치를 두지 않는 단순 비율이라,
  // 기간 중간에 큰 입출금이 있으면 수익률이 실제보다 다소 낮게/높게 보일 수 있다.
  const denominatorKRW = first.valueKRW + netFlow;
  const hasMidPeriodFlow = coveredFlows.some((flow) => flow.date > first.date && flow.date < last.date);
  const estimated = Boolean(carriedForwardSnapshot) || unrealizedBaselineMissing || hasMidPeriodFlow;

  const periodType = usedInceptionSnapshot
    ? 'since-first-deposit'
    : carriedForwardSnapshot
      ? 'carried-forward'
      : first.date === yearStartKey
        ? 'calendar-year'
        : 'recorded-period';

  const sharedFields = {
    year: numericYear,
    depositsKRW: coveredDepositsKRW,
    withdrawalsKRW: coveredWithdrawalsKRW,
    dividendsKRW: coveredDividendsKRW,
    realizedGainsKRW: coveredRealizedGainsKRW,
    unrealizedChangeKRW,
    startValueKRW: first.valueKRW,
    endValueKRW: last.valueKRW,
    startDate: first.date,
    endDate: last.date,
    snapshotCount: ownSnapshots.length,
    inferredStart: Boolean(usedInceptionSnapshot),
    joinedAtAnchored,
    carriedForward: Boolean(carriedForwardSnapshot),
    carriedForwardAsOfDate: carriedForwardSnapshot?.asOfDate || '',
    carriedForwardValueKRW: carriedForwardSnapshot ? carriedForwardSnapshot.valueKRW : null,
  };

  // 원금 기준점이 0이거나 음수면(투자 원금 자체가 없거나, 원금보다 큰 출금으로
  // 기준이 깨진 경우) 나눌 대상이 없어 퍼센트를 만들 수 없다 — 순수익이 0이라고
  // 해서 0%로 얼버무리면, "투자한 적이 없는 계좌"와 "투자해서 정확히 0% 낸 계좌"를
  // 구분하지 못하게 된다.
  if (!(denominatorKRW > EPSILON)) {
    return {
      ...sharedFields,
      status: 'insufficient',
      returnPercent: null,
      profitKRW,
      estimated: true,
      periodType: 'insufficient',
      reason: 'capital-base-required',
    };
  }

  return {
    ...sharedFields,
    status: 'ready',
    returnPercent: (profitKRW / denominatorKRW) * 100,
    profitKRW,
    estimated,
    periodType,
  };
};

export const upsertDailyPortfolioSnapshot = (snapshots = [], snapshot = {}) => {
  const date = toDateKey(snapshot.date);
  const valueKRW = Number(snapshot.valueKRW);
  if (!date || !Number.isFinite(valueKRW) || valueKRW < 0) return snapshots;

  const existing = snapshots.find((entry) => toDateKey(entry.date) === date);
  // 하루 한 번만 저장한다 — 그날 이미 값이 있으면(자동이든 수동이든) 그 뒤의
  // 자동/현재 값으로는 덮지 않는다. 수동 입력은 언제든 우선한다(새로 넣거나
  // 고쳐도 반영된다). 그날 값이 아예 없을 때만(existing이 없을 때) 새로 만든다.
  if (existing && snapshot.source !== 'manual') return snapshots;
  if (
    existing
    && existing.valueKRW === valueKRW
    && existing.unrealizedProfitKRW === snapshot.unrealizedProfitKRW
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

/**
 * 수익률 화면은 오늘의 자동 스냅샷이 아직 영구 저장되지 않았더라도 현재 총평가액으로
 * 즉시 계산해야 한다. 같은 날짜의 수동 값은 사용자가 확정한 값이므로 보존한다.
 */
export const withCurrentPortfolioSnapshot = (snapshots = [], snapshot = {}) => {
  const date = toDateKey(snapshot.date);
  const valueKRW = Number(snapshot.valueKRW);
  if (!date || !Number.isFinite(valueKRW) || valueKRW < 0) return snapshots;

  const existing = snapshots.find((entry) => toDateKey(entry.date) === date);
  if (existing?.source === 'manual') return snapshots;

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
