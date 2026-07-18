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
  },
};

// A previous release stored this value automatically for NVO. ADR custody fees are
// not charged on every dividend payment, so an unconfirmed legacy default must not
// be deducted from income. A fee entered explicitly by the user is still honored.
const LEGACY_AUTOMATIC_ADR_FEES = {
  NVO: 0.015,
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
    ?? COUNTRY_DIVIDEND_TAX_RATES[sourceCountry]
    ?? 0;
  const dividendTaxBasisPerShare = parseTradeNumber(asset.dividendTaxBasisPerShare);
  const enteredAdrFeePerShare = parseTradeNumber(asset.adrFeePerShare);
  const legacyAutomaticAdrFee = LEGACY_AUTOMATIC_ADR_FEES[ticker];
  const isUnconfirmedLegacyAutomaticAdrFee = (
    asset.adrFeePerShareExplicit !== true
    && legacyAutomaticAdrFee !== undefined
    && Math.abs(enteredAdrFeePerShare - legacyAutomaticAdrFee) < 0.0000001
  );
  const adrFeePerShare = asset.adrFeePerShareExplicit === false
    || isUnconfirmedLegacyAutomaticAdrFee
    ? 0
    : enteredAdrFeePerShare;

  return {
    accountType: asset.accountType || 'GENERAL',
    sourceCountry,
    securityType,
    dividendTaxRate,
    dividendTaxRateExplicit: asset.dividendTaxRateExplicit === true,
    taxCalculationMode: taxBasisEtf ? 'tax-basis' : 'rate',
    dividendTaxBasisPerShare,
    taxNote: taxBasisEtf
      ? dividendTaxBasisPerShare > 0
        ? '국내 상장 해외자산 ETF 세금은 입력한 주당 과표기준가 증분에 세율을 적용했습니다.'
        : '국내 상장 해외자산 ETF는 분배금 전체가 아닌 과표기준가 증분에만 과세됩니다. 과표증분 미입력 시 공시 세전 분배금을 표시하며 세후 확정액으로 간주하지 않습니다.'
      : '',
    adrFeePerShare,
    adrFeePerShareExplicit: asset.adrFeePerShareExplicit === true,
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

const formatDividendNumber = (value) => parseTradeNumber(value).toLocaleString('ko-KR', {
  maximumFractionDigits: 8,
});

const formatDividendAmount = (value, currency) => {
  const formatted = formatDividendNumber(value);
  if (currency === 'KRW') return `${formatted}원`;
  if (currency === 'USD') return `$${formatted}`;
  if (currency === 'JPY') return `¥${formatted}`;
  return `${formatted} ${currency}`.trim();
};

const buildDividendCalculationFormula = ({
  perShareGrossAmount,
  quantity,
  grossAmount,
  currency,
}) => (
  `${formatDividendAmount(perShareGrossAmount, currency)} × ${formatDividendNumber(quantity)}주 = ${formatDividendAmount(grossAmount, currency)}`
);

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

const isSyntheticOpeningBuy = (asset = {}, entry = {}) => (
  getTradeRecordSide(entry) === 'buy'
  && Boolean(asset.id)
  && String(entry.sourceId || '') === `asset-${asset.id}`
);

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

export const getHeldQuantityOnExDate = (
  asset,
  ledger = [],
  exDate = '',
  {
    allowCurrentQuantityFallback = false,
    ignoreSyntheticOpeningBuy = false,
  } = {},
) => {
  const targetTimestamp = getDateTimestampSeconds(exDate);
  if (targetTimestamp <= 0) return 0;

  const assetLedger = getAssetLedgerRows(asset, ledger);
  const quantityLedger = ignoreSyntheticOpeningBuy
    ? assetLedger.filter((entry) => !isSyntheticOpeningBuy(asset, entry))
    : assetLedger;
  const buyLedger = quantityLedger.filter((entry) => getTradeRecordSide(entry) === 'buy');
  if (buyLedger.length === 0) {
    const buyTimestamp = getDateTimestampSeconds(asset.buyDate);
    const canUseCurrentPosition = (
      allowCurrentQuantityFallback
      || (buyTimestamp > 0 && buyTimestamp < targetTimestamp)
    );
    if (!canUseCurrentPosition) return 0;

    // When an old position has no opening buy row, reconstruct the ex-date balance
    // backwards from today's quantity using any later transactions that do exist.
    const reconstructedQuantity = quantityLedger.reduce((quantity, entry) => {
      const entryTimestamp = getDateTimestampSeconds(getTradeRecordDate(entry));
      if (entryTimestamp < targetTimestamp) return quantity;
      const entryQuantity = parseTradeNumber(entry.quantity);
      return getTradeRecordSide(entry) === 'sell'
        ? quantity + entryQuantity
        : quantity - entryQuantity;
    }, parseTradeNumber(asset.quantity));

    return Math.max(0, reconstructedQuantity);
  }

  return Math.max(0, quantityLedger.reduce((sum, entry) => {
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
  const effectiveDividendStartDate = dividendStartDate || getDividendStartDate(asset, ledger);
  const buyTimestamp = getDateTimestampSeconds(effectiveDividendStartDate);
  const profile = getAssetDividendProfile(asset);
  const buyLedger = getAssetBuyLedgerRows(asset, ledger);
  const hasBuyLedger = buyLedger.length > 0;
  const sourceDividends = Object.values(dividends || {})
    .filter((dividend) => Number(dividend?.date) > 0)
    .sort((a, b) => Number(a.date) - Number(b.date));
  const pastSourceDividends = sourceDividends
    .filter((dividend) => Number(dividend.date) * 1000 <= Date.now());
  const eligibleDividends = buyTimestamp > 0
    ? pastSourceDividends.filter((dividend) => Number(dividend.date) >= buyTimestamp)
    : [];

  return eligibleDividends
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
      const heldQuantity = getHeldQuantityOnExDate(asset, ledger, exDate, {
        allowCurrentQuantityFallback: false,
        ignoreSyntheticOpeningBuy: false,
      });
      if (heldQuantity <= 0) return null;

      const perShareGrossAmount = parseTradeNumber(dividend.amount);
      const grossAmount = perShareGrossAmount * heldQuantity;
      const taxableAmount = profile.taxCalculationMode === 'tax-basis'
        ? Math.min(grossAmount, profile.dividendTaxBasisPerShare * heldQuantity)
        : grossAmount;
      const taxAmount = taxableAmount * profile.dividendTaxRate;
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
        quantitySource: hasBuyLedger ? 'trade-ledger' : 'asset-buy-date',
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
        confirmationSource: '',
        calculationSource: 'market-dividend-per-share',
        calculationValid: true,
        calculationFormula: buildDividendCalculationFormula({
          perShareGrossAmount,
          quantity: heldQuantity,
          grossAmount,
          currency,
        }),
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
  // autoDividends에 저장된 행은 과거 상태값이 actual/confirmed로 남아 있어도
  // 주당 분배금과 기준 수량이 있으면 항상 같은 공식으로 다시 산출한다.
  const hasCalculationInputs = (
    parseTradeNumber(dividend.perShareGrossAmount) > 0
    && parseTradeNumber(dividend.quantity) > 0
  );
  if (!hasCalculationInputs) return { ...dividend, calculationValid: false };

  const profile = getAssetDividendProfile(asset);
  const quantity = parseTradeNumber(dividend.quantity);
  const perShareGrossAmount = parseTradeNumber(dividend.perShareGrossAmount);
  const grossAmount = perShareGrossAmount > 0 && quantity > 0
    ? perShareGrossAmount * quantity
    : parseTradeNumber(dividend.grossAmount ?? dividend.amount);
  const taxableAmount = profile.taxCalculationMode === 'tax-basis'
    ? Math.min(grossAmount, profile.dividendTaxBasisPerShare * quantity)
    : grossAmount;
  const taxAmount = taxableAmount * profile.dividendTaxRate;
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
    confirmationSource: '',
    calculationSource: 'market-dividend-per-share',
    calculationValid: true,
    calculationFormula: perShareGrossAmount > 0 && quantity > 0
      ? buildDividendCalculationFormula({
        perShareGrossAmount,
        quantity,
        grossAmount,
        currency: dividend.currency || asset.currency || 'KRW',
      })
      : dividend.calculationFormula,
    status: 'estimated',
    recordType: 'estimate',
    taxCalculationMode: profile.taxCalculationMode,
    taxNote: profile.taxNote,
  };
};

export const isVerifiableDividendRecord = (dividend = {}) => {
  const calculatedAmount = Number(dividend.amount);
  const hasCalculationInputs = (
    parseTradeNumber(dividend.perShareGrossAmount) > 0
    && parseTradeNumber(dividend.quantity) > 0
    && Number.isFinite(calculatedAmount)
    && calculatedAmount >= 0
  );
  const isCalculated = (
    dividend.calculationValid !== false
    && dividend.calculationSource === 'market-dividend-per-share'
    && hasCalculationInputs
  );
  const isConfirmed = (
    ['paid', 'actual', 'confirmed'].includes(String(dividend.status || '').toLowerCase())
    && Boolean(dividend.confirmationSource)
    && Number.isFinite(calculatedAmount)
    && calculatedAmount >= 0
  );

  return isCalculated || isConfirmed;
};

export const selectReportedDividendRecords = (
  calculatedDividends = [],
  confirmedDividends = [],
) => {
  const verifiedConfirmed = confirmedDividends.filter(isVerifiableDividendRecord);
  const verifiedCalculated = calculatedDividends.filter(isVerifiableDividendRecord);
  if (verifiedConfirmed.length === 0) return verifiedCalculated;

  const getAssetKey = (dividend = {}) => {
    const ticker = normalizeTradeTicker(dividend.ticker || '');
    return ticker || String(dividend.name || '').trim().toUpperCase();
  };
  const getPeriodKey = (dividend = {}) => {
    const explicitPeriod = String(dividend.period || '').trim();
    if (/^\d{4}-\d{2}$/.test(explicitPeriod)) return explicitPeriod;

    const date = String(
      dividend.actualPaymentDate
      || dividend.paymentDate
      || dividend.exDate
      || dividend.date
      || '',
    ).trim();
    return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : '';
  };

  const confirmedPeriods = new Set(verifiedConfirmed.map((dividend) => (
    `${getAssetKey(dividend)}::${getPeriodKey(dividend)}`
  )));
  const confirmedAssets = new Set(verifiedConfirmed.map(getAssetKey));
  const remainingCalculated = verifiedCalculated.filter((dividend) => {
    const assetKey = getAssetKey(dividend);
    const periodKey = getPeriodKey(dividend);
    if (!assetKey) return true;
    if (!periodKey) return !confirmedAssets.has(assetKey);
    return !confirmedPeriods.has(`${assetKey}::${periodKey}`);
  });

  return [...verifiedConfirmed, ...remainingCalculated].sort((left, right) => {
    const leftDate = left.actualPaymentDate || left.paymentDate || left.exDate || left.date || left.period || '';
    const rightDate = right.actualPaymentDate || right.paymentDate || right.exDate || right.date || right.period || '';
    return String(rightDate).localeCompare(String(leftDate));
  });
};
