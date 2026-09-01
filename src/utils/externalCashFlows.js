export const NORMALIZED_TRANSACTION_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'INTERNAL',
  'UNKNOWN',
  'IGNORE',
];

const DEPOSIT_TYPES = new Set(['DEPOSIT', 'TRANSFER_IN']);
const WITHDRAWAL_TYPES = new Set(['WITHDRAWAL', 'TRANSFER_OUT']);

const normalizeType = (value) => String(value || '').trim().toUpperCase();

export const isExternalCashFlowType = (value) => {
  const type = normalizeType(value);
  return DEPOSIT_TYPES.has(type) || WITHDRAWAL_TYPES.has(type);
};

export const toCapitalFlowType = (value) => {
  const type = normalizeType(value);
  if (DEPOSIT_TYPES.has(type)) return 'deposit';
  if (WITHDRAWAL_TYPES.has(type)) return 'withdrawal';
  return '';
};

export const buildTransactionSourceIdentity = (transaction = {}) => [
  transaction.broker || '',
  transaction.accountId || '',
  transaction.transactionDate || '',
  transaction.transactionTime || '',
  transaction.rawType || '',
  Number(transaction.amount) || 0,
  String(transaction.currency || '').toUpperCase(),
  transaction.bankName || '',
  transaction.recipientName || '',
].map((value) => String(value).trim()).join('|');

const bytesToHex = (bytes) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const fallbackHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const createSourceHash = async (transaction = {}) => {
  const identity = buildTransactionSourceIdentity(transaction);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(identity);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return bytesToHex(new Uint8Array(digest));
};

/** 외부입출금 원금과 평가용 환율 메타데이터를 함께 유지한다. */
export const resolveExternalCashFlowKrw = async (transaction, resolveHistoricalFx) => {
  const currency = String(transaction?.currency || 'KRW').trim().toUpperCase();
  const amount = Math.abs(Number(transaction?.amount) || 0);
  const requestedDate = String(transaction?.transactionDate || transaction?.date || '').slice(0, 10);

  if (!isExternalCashFlowType(transaction?.normalizedType) || !(amount > 0) || !requestedDate) {
    return { ...transaction, currency, amount, amountKRW: null, fxStatus: 'NOT_REQUIRED' };
  }

  if (currency === 'KRW') {
    return {
      ...transaction,
      currency,
      amount,
      amountKRW: amount,
      fxRate: 1,
      fxRateDate: requestedDate,
      fxSource: 'BASE_CURRENCY',
      fxStatus: 'READY',
    };
  }

  const fx = typeof resolveHistoricalFx === 'function'
    ? await resolveHistoricalFx(currency, 'KRW', requestedDate)
    : null;
  if (!fx || !(Number(fx.rate) > 0)) {
    return {
      ...transaction,
      currency,
      amount,
      amountKRW: null,
      fxRate: null,
      fxRateDate: '',
      fxSource: '',
      fxStatus: 'FX_RATE_MISSING',
    };
  }

  return {
    ...transaction,
    currency,
    amount,
    amountKRW: amount * Number(fx.rate),
    fxRate: Number(fx.rate),
    fxRateDate: fx.rateDate,
    fxSource: fx.source,
    fxStatus: 'READY',
  };
};

export const toCapitalFlowRecord = (transaction = {}, importedAt = new Date().toISOString()) => {
  const type = toCapitalFlowType(transaction.normalizedType);
  if (!type) return null;
  const amountKRW = transaction.amountKRW === null || transaction.amountKRW === undefined
    ? null
    : Number(transaction.amountKRW);
  const fxRate = transaction.fxRate === null || transaction.fxRate === undefined
    ? null
    : Number(transaction.fxRate);

  return {
    id: `cashflow-${transaction.sourceHash}`,
    sourceId: transaction.sourceHash,
    broker: transaction.broker,
    accountId: transaction.accountId,
    date: transaction.transactionDate,
    transactionTime: transaction.transactionTime || '',
    type,
    normalizedType: transaction.normalizedType,
    rawType: transaction.rawType || '',
    amount: Math.abs(Number(transaction.amount) || 0),
    currency: String(transaction.currency || 'KRW').toUpperCase(),
    amountKRW: Number.isFinite(amountKRW) ? amountKRW : null,
    fxRate: Number.isFinite(fxRate) ? fxRate : null,
    fxRateDate: transaction.fxRateDate || '',
    fxSource: transaction.fxSource || '',
    fxStatus: transaction.fxStatus || '',
    description: transaction.description || '',
    sourceType: 'BROKER_PDF',
    sourceIdentifier: transaction.sourceHash,
    sourceHash: transaction.sourceHash,
    importedAt,
  };
};

export const mergeCapitalFlows = (existing = [], incoming = []) => {
  const seen = new Set(existing.map((flow) => flow.sourceHash || flow.sourceIdentifier || flow.id));
  const additions = incoming.filter((flow) => {
    const key = flow.sourceHash || flow.sourceIdentifier || flow.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing, ...additions].sort((left, right) => (
    `${left.date || ''}T${left.transactionTime || ''}`
      .localeCompare(`${right.date || ''}T${right.transactionTime || ''}`)
  ));
};

const buildPerformanceFlowIdentity = (flow = {}) => {
  const date = String(flow.date || flow.transactionDate || '').slice(0, 10);
  const type = toCapitalFlowType(flow.type || flow.normalizedType);
  const currency = String(flow.currency || 'KRW').trim().toUpperCase();
  const amount = Math.abs(Number(flow.amount));
  if (!date || !type || !Number.isFinite(amount)) return '';
  return `${date}|${type}|${currency}|${amount.toFixed(8)}`;
};

/**
 * PDF 반영 전에 사용자가 직접 입력했던 동일 거래는 DB에서 지우지 않고 TWR 입력에서만 제외한다.
 * PDF끼리는 source hash로 별도 거래를 보존하며, 원본 외화금액이 같은 교차-source 거래만 정리한다.
 */
export const dedupeCapitalFlowsForPerformance = (flows = []) => {
  const pdfFlowKeys = new Set(flows
    .filter((flow) => flow?.sourceType === 'BROKER_PDF')
    .map(buildPerformanceFlowIdentity)
    .filter(Boolean));

  return flows.filter((flow) => (
    flow?.sourceType === 'BROKER_PDF'
    || !pdfFlowKeys.has(buildPerformanceFlowIdentity(flow))
  ));
};
