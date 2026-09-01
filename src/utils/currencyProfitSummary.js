const CURRENCY_META = {
  KRW: { label: '원화', order: 0, fractionDigits: 0 },
  USD: { label: '달러', order: 1, fractionDigits: 2 },
  JPY: { label: '엔화', order: 2, fractionDigits: 0 },
};

const getCurrencyMeta = (currency) => CURRENCY_META[currency] || {
  label: currency,
  order: 9,
  fractionDigits: 2,
};

const toDisplayedMinorUnits = (value, fractionDigits) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;

  const factor = 10 ** fractionDigits;
  const magnitude = Math.round((Math.abs(numeric) + Number.EPSILON) * factor);
  return numeric < 0 ? -magnitude : magnitude;
};

/**
 * 개별 종목 카드에 표시되는 미실현 손익을 그대로 검산할 수 있도록 통화별로 묶는다.
 * 각 종목 값을 먼저 화면 표시 자릿수(원·엔 0자리, 달러 2자리)로 반올림한 뒤
 * 합산하므로 사용자가 카드의 숫자를 직접 더한 결과와 일치한다.
 */
export const summarizeUnrealizedProfitByCurrency = (assets = []) => {
  const summaries = new Map();

  ['KRW', 'USD'].forEach((currency) => {
    const meta = getCurrencyMeta(currency);
    summaries.set(currency, { currency, minorUnits: 0, assetCount: 0, ...meta });
  });

  assets
    .filter((asset) => asset.category !== '현금')
    .forEach((asset) => {
      const currency = asset.currency || 'KRW';
      const meta = getCurrencyMeta(currency);
      const summary = summaries.get(currency) || {
        currency,
        minorUnits: 0,
        assetCount: 0,
        ...meta,
      };

      summary.minorUnits += toDisplayedMinorUnits(asset.profitNative, meta.fractionDigits);
      summary.assetCount += 1;
      summaries.set(currency, summary);
    });

  return [...summaries.values()]
    .sort((left, right) => left.order - right.order || left.currency.localeCompare(right.currency))
    .map(({ currency, label, assetCount, minorUnits, fractionDigits }) => ({
      currency,
      label,
      assetCount,
      amount: minorUnits / (10 ** fractionDigits),
    }));
};
