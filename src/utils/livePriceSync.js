const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const isSuspiciousQuoteUpdate = (
  asset = {},
  nextPrice = 0,
  nextCurrency = '',
  rate = 1,
) => {
  const originalCurrentPrice = toPositiveNumber(asset.originalCurrentPrice);
  const currentPrice = originalCurrentPrice || toPositiveNumber(asset.currentPrice);
  const normalizedNextPrice = toPositiveNumber(nextPrice);
  if (currentPrice <= 0 || normalizedNextPrice <= 0) return false;

  const currentCurrency = String(asset.originalCurrency || asset.currency || '').toUpperCase();
  const normalizedNextCurrency = String(nextCurrency || '').toUpperCase();
  if (
    currentCurrency
    && normalizedNextCurrency
    && currentCurrency !== normalizedNextCurrency
  ) return false;

  const comparableNextPrice = originalCurrentPrice > 0
    ? normalizedNextPrice
    : normalizedNextPrice * (toPositiveNumber(rate) || 1);
  const ratio = Math.max(
    currentPrice / comparableNextPrice,
    comparableNextPrice / currentPrice,
  );
  return ratio >= 8;
};

export const buildLivePriceUpdate = ({
  asset = {},
  quote = null,
  rate = 1,
  checkedAt = new Date().toISOString(),
} = {}) => {
  const quotePrice = toPositiveNumber(quote?.price);
  const normalizedRate = toPositiveNumber(rate) || 1;

  if (quotePrice > 0) {
    const quoteCurrency = String(
      quote?.currency || asset.currency || asset.originalCurrency || 'KRW',
    ).toUpperCase();

    if (
      quote?.verified !== true
      && isSuspiciousQuoteUpdate(asset, quotePrice, quoteCurrency, normalizedRate)
    ) {
      return {
        status: 'rejected',
        asset: {
          ...asset,
          quoteStatus: 'rejected',
          quoteCheckedAt: checkedAt,
          quoteError: 'suspicious-price-change',
        },
      };
    }

    return {
      status: 'live',
      asset: {
        ...asset,
        currency: quoteCurrency,
        originalCurrency: quoteCurrency,
        currentPrice: Math.round(quotePrice * normalizedRate),
        originalCurrentPrice: quotePrice,
        quoteStatus: 'live',
        quoteSource: quote?.source || 'market',
        quoteSymbol: quote?.symbol || asset.ticker || '',
        quoteCheckedAt: checkedAt,
        quoteUpdatedAt: checkedAt,
        quoteProviderUpdatedAt: quote?.providerUpdatedAt || '',
        quoteValidation: quote?.validation || '',
        quoteCorroboratedBy: quote?.corroboratedBy || '',
        quoteError: '',
      },
    };
  }

  const cachedCurrency = String(
    asset.currency || asset.originalCurrency || 'KRW',
  ).toUpperCase();
  const cachedOriginalPrice = toPositiveNumber(asset.originalCurrentPrice);
  const cachedKrwPrice = toPositiveNumber(asset.currentPrice);

  if (cachedOriginalPrice > 0 || cachedKrwPrice > 0) {
    const originalCurrentPrice = cachedOriginalPrice
      || (cachedKrwPrice / normalizedRate);
    const currentPrice = cachedOriginalPrice > 0
      ? Math.round(originalCurrentPrice * normalizedRate)
      : cachedKrwPrice;

    return {
      status: 'cached',
      asset: {
        ...asset,
        currency: cachedCurrency,
        originalCurrency: cachedCurrency,
        currentPrice,
        originalCurrentPrice,
        quoteStatus: 'cached',
        quoteCheckedAt: checkedAt,
        quoteError: 'provider-unavailable',
      },
    };
  }

  return {
    status: 'failed',
    asset: {
      ...asset,
      quoteStatus: 'failed',
      quoteCheckedAt: checkedAt,
      quoteError: 'provider-unavailable',
    },
  };
};

export const summarizePriceSync = (statuses = []) => statuses.reduce((summary, status) => {
  if (status === 'live') summary.live += 1;
  else if (status === 'cached') summary.cached += 1;
  else if (status === 'rejected') summary.rejected += 1;
  else if (status === 'failed') summary.failed += 1;
  return summary;
}, {
  live: 0,
  cached: 0,
  rejected: 0,
  failed: 0,
});
