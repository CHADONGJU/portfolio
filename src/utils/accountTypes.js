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
