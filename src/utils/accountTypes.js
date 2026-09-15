// 계좌 구분(일반·ISA·연금)과 그에 따른 배당 과세 취급.
// ISA·연금 계좌는 배당소득세가 인출 시점까지 미뤄지므로, 배당 계산이
// 원천징수를 뗄지 말지를 이 판정으로 정한다.
export const ACCOUNT_TYPE_GENERAL = 'GENERAL';
export const ACCOUNT_TYPE_ISA = 'ISA';
export const ACCOUNT_TYPE_PENSION = 'PENSION';

export const ACCOUNT_TYPE_OPTIONS = [
  { value: ACCOUNT_TYPE_GENERAL, label: '일반계좌' },
  { value: ACCOUNT_TYPE_ISA, label: 'ISA' },
  { value: ACCOUNT_TYPE_PENSION, label: '연금계좌' },
];

const ACCOUNT_TYPE_ALIASES = new Map([
  ['GENERAL', ACCOUNT_TYPE_GENERAL],
  ['일반', ACCOUNT_TYPE_GENERAL],
  ['일반계좌', ACCOUNT_TYPE_GENERAL],
  ['ISA', ACCOUNT_TYPE_ISA],
  ['개인종합자산관리계좌', ACCOUNT_TYPE_ISA],
  ['PENSION', ACCOUNT_TYPE_PENSION],
  ['연금', ACCOUNT_TYPE_PENSION],
  ['연금계좌', ACCOUNT_TYPE_PENSION],
  ['연금저축', ACCOUNT_TYPE_PENSION],
  ['IRP', ACCOUNT_TYPE_PENSION],
]);

// 사용자가 2026-08-10에 직접 확인한 기존 보유 계좌 정보다.
// 배당액을 고정하는 값이 아니라, 공식 배당 계산에 쓰이는 자산 메타데이터를
// 한 번 이전하기 위한 선언이다. 이후 화면에서 바꾸면 사용자가 고른 값이 우선한다.
const USER_CONFIRMED_LEGACY_ACCOUNT_TYPES = new Map([
  ['453810', ACCOUNT_TYPE_ISA],
  ['477730', ACCOUNT_TYPE_ISA],
]);

const normalizeTicker = (ticker = '') => String(ticker || '')
  .trim()
  .toUpperCase()
  .replace(/\.KS$/, '')
  .replace(/[^A-Z0-9]/g, '');

export const normalizeAccountType = (value = '') => (
  ACCOUNT_TYPE_ALIASES.get(String(value || '').trim().toUpperCase())
  || ACCOUNT_TYPE_GENERAL
);

export const getAccountTypeLabel = (value = '') => (
  ACCOUNT_TYPE_OPTIONS.find((option) => option.value === normalizeAccountType(value))?.label
  || ACCOUNT_TYPE_OPTIONS[0].label
);

export const isDividendTaxDeferredAccount = (value = '') => {
  const accountType = normalizeAccountType(value);
  return accountType === ACCOUNT_TYPE_ISA || accountType === ACCOUNT_TYPE_PENSION;
};

/**
 * 계좌 이름(예: 키움, 토스). 같은 유형의 계좌를 여러 개 쓸 때 같은 종목을
 * 계좌마다 따로 보유하게 해 준다. 비어 있으면 예전처럼 종목 단위로 합쳐진다.
 */
export const ACCOUNT_NAME_MAX_LENGTH = 20;

export const normalizeAccountName = (value = '') => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .slice(0, ACCOUNT_NAME_MAX_LENGTH);

/**
 * 자산·원장 키 뒤에 붙이는 계좌 구분자. 계좌 이름이 없으면 빈 문자열이라
 * 계좌 이름을 쓰기 전의 키가 그대로 유지된다.
 */
export const getAccountNameKeySuffix = (record = {}) => {
  const accountName = normalizeAccountName(record.accountName);
  return accountName ? `@${accountName}` : '';
};

/** 과세 방식(유형)과 계좌 이름을 합친 보유 범위. 배당을 계좌별로 나눌 때 쓴다. */
export const getAccountScope = (record = {}) => (
  `${normalizeAccountType(record.accountType)}${getAccountNameKeySuffix(record)}`
);

/** 화면용 이름. 계좌 이름이 있으면 "삼성전자 · 토스"처럼 붙인다. */
export const formatNameWithAccount = (name = '', accountName = '') => {
  const normalizedAccountName = normalizeAccountName(accountName);
  return normalizedAccountName ? `${name} · ${normalizedAccountName}` : name;
};

export const migrateUserConfirmedAccountType = (asset = {}) => {
  const normalizedAccountType = normalizeAccountType(asset.accountType);
  const hasExplicitSource = Boolean(String(asset.accountTypeSource || '').trim());
  const confirmedAccountType = USER_CONFIRMED_LEGACY_ACCOUNT_TYPES.get(normalizeTicker(asset.ticker));

  if (!hasExplicitSource && confirmedAccountType) {
    return {
      ...asset,
      accountType: confirmedAccountType,
      accountTypeSource: 'user-confirmed-2026-08-10',
    };
  }

  if (asset.accountType === normalizedAccountType) return asset;
  return { ...asset, accountType: normalizedAccountType };
};

export const migrateUserConfirmedAccountTypes = (assets = []) => (
  (Array.isArray(assets) ? assets : []).map(migrateUserConfirmedAccountType)
);
