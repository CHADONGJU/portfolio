const toDateKey = (value) => String(value || '').slice(0, 10);

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * 가장 오래된 누락일부터 조금씩 복원하되 매일 생성 대상은 항상 포함한다.
 * 실제 복원은 historical quote/FX/holdings가 모두 있을 때만 complete가 될 수 있다.
 */
export const buildSnapshotRecoveryDates = ({
  accountInceptionDate,
  twrAvailableFrom,
  serviceJoinedAt,
  // 기존 호출 호환용
  joinedAt,
  targetDate,
  existingDates = [],
  maxDates = 7,
} = {}) => {
  const startDate = toDateKey(
    accountInceptionDate || twrAvailableFrom || serviceJoinedAt || joinedAt,
  );
  const endDate = toDateKey(targetDate);
  if (!startDate || !endDate || startDate > endDate) return [];
  const existing = new Set(existingDates.map(toDateKey));
  const missing = [];

  for (let date = startDate; date && date <= endDate; date = shiftDate(date, 1)) {
    if (!existing.has(date)) missing.push(date);
  }

  if (missing.length <= maxDates) return missing;
  const earliest = missing.slice(0, Math.max(0, maxDates - 1));
  return [...new Set([...earliest, endDate])].sort();
};

const CONDITIONAL_REPLAY_COVERAGE = [
  ['externalCashFlowsComplete', 'externalCashFlows', 'external-cash-flow-history-incomplete'],
  ['tradeLedgerComplete', 'trades', 'trade-ledger-incomplete'],
  ['cashLedgerComplete', 'cashMovements', 'cash-ledger-incomplete'],
  ['fxLedgerComplete', 'fxTransactions', 'fx-ledger-incomplete'],
  ['dividendsComplete', 'dividends', 'dividend-history-incomplete'],
  ['feesAndTaxesComplete', 'feesAndTaxes', 'fee-tax-history-incomplete'],
  ['corporateActionsComplete', 'corporateActions', 'corporate-action-history-incomplete'],
  ['settlementDataComplete', 'settlements', 'settlement-history-incomplete'],
];

const getEventCount = (eventCounts, key) => {
  const value = Number(eventCounts?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const canRecoverHistoricalValuation = ({
  assets = [],
  historicalQuotes = [],
  coverage = {},
  eventCounts = {},
} = {}) => {
  const hasUnledgeredCash = assets.some((asset) => (
    String(asset.category || '').trim() === '현금' && !asset.balanceDate
  ));
  const quoteCount = historicalQuotes.filter((quote) => Number(quote?.price) > 0).length;
  const pricedAssetCount = assets.filter((asset) => String(asset.category || '').trim() !== '현금').length;
  const foreignAssetCount = assets.filter((asset) => (
    String(asset.currency || 'KRW').trim().toUpperCase() !== 'KRW'
  )).length;
  const tradesRequired = pricedAssetCount > 0 || getEventCount(eventCounts, 'trades') > 0;
  const cashLedgerRequired = assets.some((asset) => String(asset.category || '').trim() === '현금')
    || getEventCount(eventCounts, 'cashMovements') > 0
    || getEventCount(eventCounts, 'externalCashFlows') > 0
    || getEventCount(eventCounts, 'trades') > 0;
  const reasons = [];
  if (hasUnledgeredCash) reasons.push('historical-cash-balance-missing');
  if (pricedAssetCount > 0 && (
    quoteCount < pricedAssetCount || coverage.historicalPricesComplete !== true
  )) reasons.push('historical-close-missing');
  if ((foreignAssetCount > 0 || getEventCount(eventCounts, 'fxTransactions') > 0)
    && coverage.historicalFxComplete !== true) reasons.push('historical-fx-missing');

  CONDITIONAL_REPLAY_COVERAGE.forEach(([field, eventKey, reason]) => {
    const required = eventKey === 'trades'
      ? tradesRequired
      : eventKey === 'cashMovements'
        ? cashLedgerRequired
        : getEventCount(eventCounts, eventKey) > 0;
    if (required && coverage[field] !== true && !reasons.includes(reason)) reasons.push(reason);
  });
  return { recoverable: reasons.length === 0, reasons };
};

/** 모든 원장 replay와 평가 검증이 끝난 날짜만 historical Snapshot으로 승격한다. */
export const createVerifiedHistoricalSnapshot = ({
  date,
  valuation,
  assets = [],
  historicalQuotes = [],
  coverage = {},
  eventCounts = {},
  generatedAt = new Date().toISOString(),
} = {}) => {
  const dateKey = toDateKey(date);
  const recovery = canRecoverHistoricalValuation({
    assets, historicalQuotes, coverage, eventCounts,
  });
  const valueKRW = Number(valuation?.valueKRW);
  const valuationComplete = valuation?.status === 'complete'
    && Number.isFinite(valueKRW)
    && valueKRW >= 0
    && (valuation?.missingAssets?.length || 0) === 0
    && (valuation?.missingCurrencies?.length || 0) === 0;
  if (!dateKey || !recovery.recoverable || !valuationComplete) {
    return {
      status: 'rejected',
      reasons: [
        ...recovery.reasons,
        ...(valuationComplete ? [] : ['historical-valuation-incomplete']),
      ],
      snapshot: null,
    };
  }

  return {
    status: 'verified',
    reasons: [],
    snapshot: {
      id: `snapshot-${dateKey}`,
      date: dateKey,
      valueKRW,
      unrealizedProfitKRW: Number.isFinite(Number(valuation.unrealizedProfitKRW))
        ? Number(valuation.unrealizedProfitKRW)
        : null,
      includesCash: true,
      status: 'complete',
      source: 'historical-reconstruction',
      validationStatus: 'verified',
      valuationValidation: 'confirmed',
      reconstructionEventCounts: eventCounts,
      generatedAt,
      valuationBasis: 'eod',
      valuationTimestamp: `${dateKey}T23:59:59.999+09:00`,
    },
  };
};
