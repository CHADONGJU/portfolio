import {
  getTradeRecordDate,
  getTradeRecordSide,
  normalizeTradeTicker,
  parseTradeNumber,
} from './tradeReconciliation.js';

const COUNTRY_DIVIDEND_TAX_RATES = {
  KR: 0.154,
  US: 0.15,
  DK: 0.27,
  JP: 0.15315,
};

const KNOWN_SECURITY_PROFILES = {
  NVO: {
    sourceCountry: 'DK',
    securityType: 'ADR',
    dividendTaxRate: 0.27,
    adrFeePerShare: 0.015,
  },
};

const DOMESTIC_ETF_NAME_PATTERN = /\b(KODEX|TIGER|ACE|RISE|SOL|HANARO|KOSEF|PLUS|TIMEFOLIO|KBSTAR|ARIRANG|WON|KIWOOM|FOCUS)\b|ETF/i;
const FOREIGN_ASSET_NAME_PATTERN = /미국|인도|일본|차이나|중국|글로벌|유럽|베트남|대만|선진국|신흥국|해외|나스닥|S&P|NIFTY/i;
const KNOWN_DOMESTIC_FOREIGN_ETFS = new Set(['477730', '453870', '453810']);

const normalizeRate = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = parseTradeNumber(value);
  if (parsed < 0) return null;
  return parsed > 1 ? parsed / 100 : parsed;
};

const inferSourceCountry = (asset = {}) => {
  const ticker = normalizeTradeTicker(asset.ticker || '');
  const knownProfile = KNOWN_SECURITY_PROFILES[ticker];
  if (knownProfile?.sourceCountry) return knownProfile.sourceCountry;
  if (asset.category === '국내주식' || asset.currency === 'KRW') return 'KR';
  if (asset.currency === 'JPY') return 'JP';
  return 'US';
};

const inferSecurityType = (asset = {}) => {
  const ticker = normalizeTradeTicker(asset.ticker || '');
  const knownProfile = KNOWN_SECURITY_PROFILES[ticker];
  if (knownProfile?.securityType) return knownProfile.securityType;

  const isDomesticListing = asset.category === '국내주식' || asset.currency === 'KRW';
  if (
    isDomesticListing
    && (
      KNOWN_DOMESTIC_FOREIGN_ETFS.has(ticker)
      || DOMESTIC_ETF_NAME_PATTERN.test(String(asset.name || ''))
    )
  ) {
    return 'ETF';
  }

  return asset.securityType || 'STOCK';
};

export const isDomesticForeignAssetEtf = (asset = {}) => {
  const ticker = normalizeTradeTicker(asset.ticker || '');
  const isDomesticListing = asset.category === '국내주식' || asset.currency === 'KRW';
  if (!isDomesticListing || inferSecurityType(asset) !== 'ETF') return false;

  return (
    KNOWN_DOMESTIC_FOREIGN_ETFS.has(ticker)
    || FOREIGN_ASSET_NAME_PATTERN.test(String(asset.name || ''))
  );
};

export const getAssetDividendProfile = (asset = {}) => {
  const ticker = normalizeTradeTicker(asset.ticker || '');
  const knownProfile = KNOWN_SECURITY_PROFILES[ticker] || {};
  const sourceCountry = String(
    asset.sourceCountry || knownProfile.sourceCountry || inferSourceCountry(asset),
  ).toUpperCase();
  const securityType = inferSecurityType(asset);
  const taxBasisEtf = isDomesticForeignAssetEtf({
    ...asset,
    securityType,
  });
  const enteredTaxRate = normalizeRate(asset.dividendTaxRate);
  const isStoredAutomaticTaxRate = (
    taxBasisEtf
    && asset.dividendTaxRateExplicit !== true
    && (
      enteredTaxRate === COUNTRY_DIVIDEND_TAX_RATES.KR
      || enteredTaxRate === 0
    )
  );
  const explicitTaxRate = (
    asset.dividendTaxRateExplicit === false
    || isStoredAutomaticTaxRate
  ) ? null : enteredTaxRate;
  const dividendTaxRate = explicitTaxRate
    ?? knownProfile.dividendTaxRate
    ?? (taxBasisEtf ? 0 : COUNTRY_DIVIDEND_TAX_RATES[sourceCountry])
    ?? 0.154;

  return {
    accountType: asset.accountType || 'GENERAL',
    sourceCountry,
    securityType,
    dividendTaxRate,
    dividendTaxRateExplicit: asset.dividendTaxRateExplicit === true,
    taxCalculationMode: taxBasisEtf && explicitTaxRate === null ? 'tax-basis' : 'rate',
    taxNote: taxBasisEtf && explicitTaxRate === null
      ? '국내 상장 해외자산 ETF는 과표기준가 증분이 있어야 실제 원천세를 계산할 수 있어 자동 계산에서는 세전 분배금을 표시합니다.'
      : '',
    adrFeePerShare: parseTradeNumber(
      asset.adrFeePerShare ?? knownProfile.adrFeePerShare,
    ),
    dividendFlatFee: parseTradeNumber(asset.dividendFlatFee),
  };
};

export const getDateTimestampSeconds = (date = '') => {
  const rawDate = String(date || '').trim();
  const dateParts = rawDate.match(/\d+/g);
  const normalizedDate = dateParts?.length >= 3
    ? `${dateParts[0].padStart(4, '0')}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`
    : rawDate.replace(/\s*\/\s*/g, '-').replace(/\s+/g, '');
  const timestamp = new Date(`${normalizedDate}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp / 1000 : 0;
};

const isSameAssetRecord = (asset = {}, record = {}) => {
  const assetTicker = normalizeTradeTicker(asset.ticker || '');
  const recordTicker = normalizeTradeTicker(record.ticker || '');

  return Boolean(
    (asset.id && record.assetId && String(asset.id) === String(record.assetId))
    || (assetTicker && recordTicker && assetTicker === recordTicker)
    || (asset.name && record.name && asset.name === record.name)
  );
};

export const getAssetLedgerRows = (asset, ledger = []) => ledger
  .filter((entry) => getTradeRecordDate(entry) && isSameAssetRecord(asset, entry))
  .sort((a, b) => (
    getDateTimestampSeconds(getTradeRecordDate(a))
    - getDateTimestampSeconds(getTradeRecordDate(b))
  ));

export const getAssetBuyLedgerRows = (asset, ledger = []) => getAssetLedgerRows(asset, ledger)
  .filter((entry) => getTradeRecordSide(entry) === 'buy')
  .sort((a, b) => {
    const dateDelta = getDateTimestampSeconds(getTradeRecordDate(a))
      - getDateTimestampSeconds(getTradeRecordDate(b));
    if (dateDelta !== 0) return dateDelta;
    return String(a.id || a.sourceId || '').localeCompare(String(b.id || b.sourceId || ''));
  });

export const getDividendStartDate = (asset, ledger = []) => {
  const firstBuy = getAssetBuyLedgerRows(asset, ledger)
    .map((entry) => getTradeRecordDate(entry))
    .filter(Boolean)
    .sort()[0];

  const candidates = [firstBuy, asset.buyDate]
    .filter(Boolean)
    .map((date) => ({ date, timestamp: getDateTimestampSeconds(date) }))
    .filter((entry) => entry.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  return candidates[0]?.date || '';
};

export const getHeldQuantityOnExDate = (asset, ledger = [], exDate = '') => {
  const targetTimestamp = getDateTimestampSeconds(exDate);
  if (targetTimestamp <= 0) return 0;

  const assetLedger = getAssetLedgerRows(asset, ledger);
  if (assetLedger.length === 0) {
    const buyTimestamp = getDateTimestampSeconds(asset.buyDate);
    return buyTimestamp > 0 && buyTimestamp < targetTimestamp
      ? parseTradeNumber(asset.quantity)
      : 0;
  }

  return Math.max(0, assetLedger.reduce((sum, entry) => {
    const entryTimestamp = getDateTimestampSeconds(getTradeRecordDate(entry));
    // Yahoo의 배당 이벤트 날짜는 배당락일이다. 당일 매수는 제외하고
    // 당일 매도는 기존 보유자의 권리를 유지하므로 전일 종료 수량을 사용한다.
    if (entryTimestamp <= 0 || entryTimestamp >= targetTimestamp) return sum;
    const quantity = parseTradeNumber(entry.quantity);
    return getTradeRecordSide(entry) === 'sell' ? sum - quantity : sum + quantity;
  }, 0));
};

export const buildAutoDividendRows = ({
  asset,
  ledger = [],
  dividends = {},
  dividendStartDate = '',
}) => {
  const buyTimestamp = getDateTimestampSeconds(dividendStartDate || asset.buyDate);
  const profile = getAssetDividendProfile(asset);

  return Object.values(dividends || {})
    .filter((dividend) => Number(dividend.date) >= buyTimestamp)
    .map((dividend) => {
      const currency = asset.originalCurrency || asset.currency || 'KRW';
      const exDate = new Date(Number(dividend.date) * 1000).toISOString().split('T')[0];
      const normalizeEventDate = (value) => {
        if (!value) return '';
        const rawValue = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;
        if (Number.isFinite(Number(value)) && Number(value) > 100000000) {
          return new Date(Number(value) * 1000).toISOString().split('T')[0];
        }
        const timestamp = getDateTimestampSeconds(value);
        return timestamp > 0 ? new Date(timestamp * 1000).toISOString().split('T')[0] : '';
      };
      const heldQuantity = getHeldQuantityOnExDate(asset, ledger, exDate);
      if (heldQuantity <= 0) return null;

      const perShareGrossAmount = parseTradeNumber(dividend.amount);
      const grossAmount = perShareGrossAmount * heldQuantity;
      const taxAmount = grossAmount * profile.dividendTaxRate;
      const feeAmount = (
        profile.adrFeePerShare * heldQuantity
        + profile.dividendFlatFee
      );
      const amount = Math.max(0, grossAmount - taxAmount - feeAmount);

      return {
        id: `${asset.id}-${dividend.date}`,
        date: exDate,
        exDate,
        recordDate: normalizeEventDate(dividend.recordDate),
        paymentDate: normalizeEventDate(dividend.paymentDate),
        actualPaymentDate: '',
        name: asset.name,
        ticker: asset.ticker || '',
        quantity: heldQuantity,
        perShareGrossAmount,
        perShareNetAmount: heldQuantity > 0 ? amount / heldQuantity : 0,
        grossAmount,
        taxAmount,
        feeAmount,
        taxRate: profile.dividendTaxRate,
        amount,
        currency,
        sourceCountry: profile.sourceCountry,
        securityType: profile.securityType,
        accountType: profile.accountType,
        status: 'estimated',
        recordType: 'estimate',
        taxCalculationMode: profile.taxCalculationMode,
        taxNote: profile.taxNote,
      };
    })
    .filter(Boolean);
};

export const isEstimatedDividendRecord = (dividend = {}) => (
  dividend.recordType === 'estimate'
  || dividend.status === 'estimated'
  || (
    !dividend.recordType
    && !['paid', 'actual', 'confirmed'].includes(String(dividend.status || '').toLowerCase())
    && (
      dividend.perShareGrossAmount !== undefined
      || dividend.grossAmount !== undefined
    )
  )
);

export const recalculateEstimatedDividendRow = (dividend = {}, asset = {}) => {
  if (!isEstimatedDividendRecord(dividend)) return dividend;

  const profile = getAssetDividendProfile(asset);
  const quantity = parseTradeNumber(dividend.quantity);
  const perShareGrossAmount = parseTradeNumber(dividend.perShareGrossAmount);
  const grossAmount = perShareGrossAmount > 0 && quantity > 0
    ? perShareGrossAmount * quantity
    : parseTradeNumber(dividend.grossAmount ?? dividend.amount);
  const taxAmount = grossAmount * profile.dividendTaxRate;
  const feeAmount = (
    profile.adrFeePerShare * quantity
    + profile.dividendFlatFee
  );
  const amount = Math.max(0, grossAmount - taxAmount - feeAmount);

  return {
    ...dividend,
    quantity,
    perShareGrossAmount,
    perShareNetAmount: quantity > 0 ? amount / quantity : 0,
    grossAmount,
    taxAmount,
    feeAmount,
    taxRate: profile.dividendTaxRate,
    amount,
    sourceCountry: profile.sourceCountry,
    securityType: profile.securityType,
    accountType: profile.accountType,
    status: 'estimated',
    recordType: 'estimate',
    taxCalculationMode: profile.taxCalculationMode,
    taxNote: profile.taxNote,
  };
};
