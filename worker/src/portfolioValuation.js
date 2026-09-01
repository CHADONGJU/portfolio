const parseNumber = (value) => Number(String(value ?? '').replaceAll(',', '')) || 0;

const resolveFxEntry = (fxRates, currency) => {
  const code = String(currency || 'KRW').toUpperCase();
  if (code === 'KRW') return {
    rate: 1,
    rateDate: '',
    validationStatus: 'confirmed',
    source: 'base-currency',
  };
  const entry = fxRates instanceof Map ? fxRates.get(code) : fxRates?.[code];
  if (entry && typeof entry === 'object') return entry;
  return { rate: Number(entry) || 0, rateDate: '', validationStatus: '' };
};

const readStoredNativePrice = (asset, fxRate) => {
  const native = parseNumber(asset.originalCurrentPrice);
  if (native > 0) return native;
  const converted = parseNumber(asset.currentPrice);
  return converted > 0 && fxRate > 0 ? converted / fxRate : 0;
};

export const collectValuationCurrencies = (assets = [], quotes = []) => new Set(
  assets.map((asset, index) => (
    quotes[index]?.currency || asset.currency || asset.originalCurrency || 'KRW'
  )).map((currency) => String(currency).toUpperCase()).filter((currency) => currency !== 'KRW'),
);

/** 현금도 quantity x 당일환율로 포함한다. 누락 데이터는 숨기지 않고 incomplete로 남긴다. */
export const calculatePortfolioValuation = ({
  assets = [],
  quotes = [],
  fxRates = {},
  targetDate = '',
} = {}) => {
  let valueKRW = 0;
  const missingAssets = [];
  const missingCurrencies = new Set();
  const assetValues = [];
  const valuationIssues = [];

  assets.forEach((asset, index) => {
    const quantity = parseNumber(asset.quantity);
    const isCash = String(asset.category || '').trim() === '현금';
    const quote = isCash ? null : quotes[index];
    const currency = String(quote?.currency || asset.currency || asset.originalCurrency || 'KRW').toUpperCase();
    const fxEntry = resolveFxEntry(fxRates, currency);
    const fxRate = Number(fxEntry?.rate) || 0;
    const quotePrice = Number(quote?.price);
    const storedPrice = readStoredNativePrice(asset, fxRate);
    const nativePrice = isCash ? 1 : (quotePrice > 0 ? quotePrice : storedPrice);
    const usedStoredPrice = !isCash && !(quotePrice > 0) && storedPrice > 0;
    const quoteConfirmed = isCash || !targetDate || (
      ['confirmed-close', 'confirmed-close-fallback'].includes(quote?.priceStatus)
      && quote?.priceDate <= targetDate
      && (
        quote?.marketDayStatus === 'closed'
        || quote?.priceDate === targetDate
      )
    );
    const fxConfirmed = currency === 'KRW' || !targetDate || (
      fxEntry?.validationStatus === 'confirmed'
      && String(fxEntry?.rateDate || '') <= targetDate
    );

    if (!(quantity >= 0) || !(nativePrice >= 0)) {
      missingAssets.push(asset.ticker || asset.name || asset.id || `asset-${index}`);
      return;
    }
    if (!(fxRate > 0)) {
      missingCurrencies.add(currency);
      return;
    }
    if (!isCash && (!(quotePrice > 0) || !quoteConfirmed)) {
      missingAssets.push(asset.ticker || asset.name || asset.id || `asset-${index}`);
      valuationIssues.push({
        assetId: String(asset.id ?? asset.assetId ?? ''),
        ticker: asset.ticker || '',
        reason: quote?.priceStatus === 'pending-close'
          ? 'market-close-pending'
          : 'confirmed-close-missing',
        requestedDate: targetDate,
        priceDate: quote?.priceDate || '',
      });
    }
    if (!fxConfirmed) {
      missingCurrencies.add(currency);
      valuationIssues.push({
        currency,
        reason: 'confirmed-fx-rate-missing',
        requestedDate: targetDate,
        rateDate: fxEntry?.rateDate || '',
      });
    }

    const currentValueKRW = quantity * nativePrice * fxRate;
    valueKRW += currentValueKRW;
    assetValues.push({
      assetId: String(asset.id ?? asset.assetId ?? ''),
      ticker: asset.ticker || '',
      category: asset.category || '',
      currency,
      quantity,
      nativePrice,
      fxRate,
      valueKRW: currentValueKRW,
      quoteSource: isCash ? 'cash-balance' : (quote?.source || asset.quoteSource || 'stored-price'),
      priceDate: isCash ? targetDate : (quote?.priceDate || ''),
      priceStatus: isCash ? 'confirmed-balance' : (quote?.priceStatus || ''),
      marketDayStatus: isCash ? 'not-applicable' : (quote?.marketDayStatus || ''),
      exchangeTimezone: isCash ? '' : (quote?.exchangeTimezone || ''),
      fxRateDate: currency === 'KRW' ? targetDate : (fxEntry?.rateDate || ''),
      fxValidationStatus: currency === 'KRW' ? 'confirmed' : (fxEntry?.validationStatus || ''),
      usedStoredPrice,
    });
  });

  return {
    valueKRW,
    includesCash: true,
    status: missingAssets.length > 0 || missingCurrencies.size > 0 ? 'incomplete' : 'complete',
    missingAssets,
    missingCurrencies: [...missingCurrencies],
    assetValues,
    valuationIssues,
  };
};
