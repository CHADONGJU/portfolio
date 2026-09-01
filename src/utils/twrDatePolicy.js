const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toDateKey = (value) => String(value || '').slice(0, 10);

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isExternalFlow = (flow) => [
  'deposit', 'withdrawal', 'transfer_in', 'transfer_out',
].includes(String(flow?.type || flow?.normalizedType || '').trim().toLowerCase());

const getTradeDate = (trade) => toDateKey(
  trade?.date || trade?.transactionDate || trade?.buyDate || trade?.sellDate,
);

const hasCompleteSnapshotValue = (snapshot) => {
  const date = toDateKey(snapshot?.date);
  const valueKRW = Number(snapshot?.valueKRW);
  const status = String(snapshot?.status || '').trim().toLowerCase();
  return DATE_PATTERN.test(date)
    && Number.isFinite(valueKRW)
    && valueKRW >= 0
    && status === 'complete';
};

const isGeneratedAfterScheduledCutoff = (snapshot) => {
  const date = toDateKey(snapshot?.date);
  const generatedAt = Date.parse(String(snapshot?.generatedAt || ''));
  const valuationTimestamp = Date.parse(String(snapshot?.valuationTimestamp || ''));
  const nextDate = shiftDate(date, 1);
  const cutoff = Date.parse(`${nextDate}T07:10:00+09:00`);
  return Number.isFinite(generatedAt)
    && Number.isFinite(valuationTimestamp)
    && Number.isFinite(cutoff)
    && generatedAt >= cutoff
    && valuationTimestamp >= cutoff;
};

/** 공식 TWR이 신뢰할 수 있는 출처·시각·검증 메타데이터를 모두 갖춘 Snapshot이다. */
export const isFormalTwrSnapshot = (snapshot) => {
  if (!hasCompleteSnapshotValue(snapshot) || snapshot?.includesCash !== true) return false;
  const source = String(snapshot?.source || '').trim().toLowerCase();
  const valuationTimestamp = String(snapshot?.valuationTimestamp || '');
  const valuationValidation = String(snapshot?.valuationValidation || '').trim().toLowerCase();

  if (source === 'initial') {
    return snapshot?.valuationBasis === 'setup-complete'
      && Boolean(valuationTimestamp)
      && valuationValidation === 'confirmed';
  }
  if (source === 'historical-reconstruction') {
    return snapshot?.validationStatus === 'verified'
      && snapshot?.valuationBasis === 'eod'
      && Boolean(valuationTimestamp)
      && valuationValidation === 'confirmed';
  }
  if (source === 'cloudflare-cron') {
    return snapshot?.valuationBasis === 'eod'
      && Boolean(valuationTimestamp)
      && valuationValidation === 'confirmed'
      && isGeneratedAfterScheduledCutoff(snapshot);
  }
  return false;
};

const isCompleteSnapshot = isFormalTwrSnapshot;

export const isVerifiedHistoricalSnapshot = (snapshot) => (
  hasCompleteSnapshotValue(snapshot)
  && snapshot?.source === 'historical-reconstruction'
  && snapshot?.validationStatus === 'verified'
  && snapshot?.includesCash === true
  && snapshot?.valuationBasis === 'eod'
  && Boolean(snapshot?.valuationTimestamp)
  && snapshot?.valuationValidation === 'confirmed'
);

/** 실제 외부 입출금·매매·보유자산에서 확인되는 가장 이른 계좌 활동일이다. */
export const deriveAccountInceptionDate = ({
  capitalFlows = [],
  tradeLedger = [],
  trades = [],
  assets = [],
} = {}) => {
  const dates = [
    ...capitalFlows.filter(isExternalFlow).map((flow) => toDateKey(flow.date || flow.transactionDate)),
    ...tradeLedger.map(getTradeDate),
    ...trades.map(getTradeDate),
    ...assets.map((asset) => toDateKey(asset.buyDate)),
  ].filter((date) => DATE_PATTERN.test(date));
  return dates.sort().at(0) || '';
};

const getEligibleSnapshots = ({ snapshots, serviceJoinedAt, accountInceptionDate }) => {
  const joinedDate = toDateKey(serviceJoinedAt);
  const inceptionDate = toDateKey(accountInceptionDate);
  const byDate = new Map();

  snapshots.forEach((snapshot) => {
    if (!isCompleteSnapshot(snapshot)) return;
    const date = toDateKey(snapshot.date);
    if (inceptionDate && date < inceptionDate) return;
    if (joinedDate && date < joinedDate && !isVerifiedHistoricalSnapshot(snapshot)) return;
    byDate.set(date, { ...snapshot, date, valueKRW: Number(snapshot.valueKRW) });
  });

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

/**
 * 정확한 Snapshot이 끊김 없이 이어지는 최신 구간의 첫 날짜다.
 * 가입 이전 Snapshot은 검증 완료된 historical reconstruction만 인정한다.
 */
export const deriveTwrAvailableFrom = ({
  snapshots = [],
  serviceJoinedAt,
  accountInceptionDate,
} = {}) => {
  const eligible = getEligibleSnapshots({ snapshots, serviceJoinedAt, accountInceptionDate });
  if (eligible.length === 0) return '';

  let startIndex = eligible.length - 1;
  while (
    startIndex > 0
    && eligible[startIndex - 1].date === shiftDate(eligible[startIndex].date, -1)
  ) {
    startIndex -= 1;
  }
  return eligible[startIndex].date;
};

export const deriveTwrDatePolicy = ({
  capitalFlows = [],
  tradeLedger = [],
  trades = [],
  assets = [],
  snapshots = [],
  serviceJoinedAt,
} = {}) => {
  const normalizedServiceJoinedAt = toDateKey(serviceJoinedAt);
  const accountInceptionDate = deriveAccountInceptionDate({
    capitalFlows, tradeLedger, trades, assets,
  });
  const twrAvailableFrom = deriveTwrAvailableFrom({
    snapshots,
    serviceJoinedAt: normalizedServiceJoinedAt,
    accountInceptionDate,
  });
  return {
    accountInceptionDate,
    serviceJoinedAt: normalizedServiceJoinedAt,
    twrAvailableFrom,
  };
};

/** 신규 사용자의 최초 평가액은 시세·환율 적용이 끝난 정상 포트폴리오만 저장한다. */
export const isInitialSnapshotValuationReady = ({ assets = [], totalValueKRW } = {}) => (
  assets.length > 0
  && Number.isFinite(Number(totalValueKRW))
  && Number(totalValueKRW) >= 0
  && assets.every((asset) => {
    if (String(asset?.category || '').trim() === '현금') {
      return Number.isFinite(Number(asset.currentKRW));
    }
    const quoteStatus = String(asset?.quoteStatus || '').toLowerCase();
    return Number(asset?.currentPrice) > 0
      && Number.isFinite(Number(asset?.currentKRW))
      && quoteStatus === 'live';
  })
);

/**
 * 가입/최초 설정 중에는 오늘 Initial Snapshot을 INITIALIZING 상태로 갱신한다.
 * COMPLETE로 확정된 뒤에는 같은 날짜라도 절대 덮어쓰지 않는다.
 */
export const ensureInitialPortfolioSnapshot = ({
  snapshots = [],
  serviceJoinedAt,
  snapshotDate,
  valueKRW,
  unrealizedProfitKRW = null,
  valuationReady = false,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const joinedDate = toDateKey(serviceJoinedAt);
  const date = toDateKey(snapshotDate);
  if (!DATE_PATTERN.test(joinedDate) || !DATE_PATTERN.test(date) || date < joinedDate) return snapshots;
  if (!valuationReady || !Number.isFinite(Number(valueKRW)) || Number(valueKRW) < 0) return snapshots;

  const hasLaterNormalSnapshot = snapshots.some((snapshot) => (
    isCompleteSnapshot(snapshot)
    && toDateKey(snapshot.date) >= joinedDate
  ));
  if (hasLaterNormalSnapshot) return snapshots;

  const nextSnapshot = {
    id: `snapshot-${date}`,
    date,
    valueKRW: Number(valueKRW),
    unrealizedProfitKRW: Number.isFinite(Number(unrealizedProfitKRW))
      ? Number(unrealizedProfitKRW)
      : null,
    includesCash: true,
    status: 'initializing',
    source: 'initial',
    generatedAt,
    valuationBasis: 'setup-in-progress',
  };
  const sameDateIndex = snapshots.findIndex((snapshot) => toDateKey(snapshot.date) === date);
  const sameDateSnapshot = sameDateIndex >= 0 ? snapshots[sameDateIndex] : null;
  if (
    sameDateSnapshot?.source === 'initial'
    && Number(sameDateSnapshot.valueKRW) === nextSnapshot.valueKRW
    && Number(sameDateSnapshot.unrealizedProfitKRW) === Number(nextSnapshot.unrealizedProfitKRW)
  ) return snapshots;
  const next = sameDateIndex >= 0
    ? snapshots.map((snapshot, index) => (index === sameDateIndex ? nextSnapshot : snapshot))
    : [...snapshots, nextSnapshot];
  return next.sort((left, right) => toDateKey(left.date).localeCompare(toDateKey(right.date)));
};

/** 사용자가 초기 포트폴리오 설정을 끝냈을 때 기준 평가액을 한 번만 확정·잠근다. */
export const completeInitialPortfolioSnapshot = ({
  snapshots = [],
  snapshotDate,
  completedAt = new Date().toISOString(),
} = {}) => {
  const date = toDateKey(snapshotDate);
  const index = snapshots.findIndex((snapshot) => (
    toDateKey(snapshot?.date) === date
    && snapshot?.source === 'initial'
    && String(snapshot?.status || '').trim().toLowerCase() === 'initializing'
  ));
  if (index < 0) return snapshots;

  return snapshots.map((snapshot, snapshotIndex) => (snapshotIndex === index ? {
    ...snapshot,
    status: 'complete',
    valuationBasis: 'setup-complete',
    valuationTimestamp: completedAt,
    valuationValidation: 'confirmed',
    completedAt,
    lockedAt: completedAt,
  } : snapshot));
};

/** 검증 완료 표시가 없는 과거 평가액은 TWR Snapshot 컬렉션에 들어갈 수 없다. */
export const mergeVerifiedHistoricalSnapshots = (existing = [], incoming = []) => {
  const byDate = new Map(existing.map((snapshot) => [toDateKey(snapshot.date), snapshot]));
  incoming.filter(isVerifiedHistoricalSnapshot).forEach((snapshot) => {
    const date = toDateKey(snapshot.date);
    const current = byDate.get(date);
    if (current && isCompleteSnapshot(current)) return;
    byDate.set(date, {
      ...snapshot,
      id: snapshot.id || `snapshot-${date}`,
      date,
      valueKRW: Number(snapshot.valueKRW),
    });
  });
  return [...byDate.values()].sort((left, right) => toDateKey(left.date).localeCompare(toDateKey(right.date)));
};
