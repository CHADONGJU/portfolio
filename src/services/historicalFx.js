const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LOOKBACK_DAYS = 10;

const toDateKey = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
};

const hasRequestBudget = (budget) => (
  !budget || !Number.isFinite(Number(budget.remaining)) || Number(budget.remaining) > 0
);

const fetchJson = async (fetchImpl, url, timeoutMs, requestBudget) => {
  if (!hasRequestBudget(requestBudget)) return null;
  if (requestBudget && Number.isFinite(Number(requestBudget.remaining))) {
    requestBudget.remaining = Number(requestBudget.remaining) - 1;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const readFrankfurterRate = (data, currency, baseCurrency, requestedDate) => {
  const rate = Number(data?.rates?.[baseCurrency]);
  const rateDate = DATE_PATTERN.test(String(data?.date || '')) ? data.date : requestedDate;
  if (!(rate > 0) || rateDate > requestedDate) return null;
  return {
    currency,
    baseCurrency,
    requestedDate,
    rateDate,
    rate,
    source: 'FRANKFURTER_ECB',
  };
};

const readFawazRate = (data, currency, baseCurrency, requestedDate) => {
  const currencyKey = currency.toLowerCase();
  const baseKey = baseCurrency.toLowerCase();
  const rate = Number(data?.[currencyKey]?.[baseKey]);
  const reportedDate = String(data?.date || '');
  const rateDate = DATE_PATTERN.test(reportedDate) ? reportedDate : requestedDate;
  if (!(rate > 0) || rateDate > requestedDate) return null;
  return {
    currency,
    baseCurrency,
    requestedDate,
    rateDate,
    rate,
    source: 'FAWAZ_CURRENCY_API',
  };
};

const providerRequests = (currency, baseCurrency, candidateDate, requestedDate) => [
  {
    source: 'FRANKFURTER_ECB',
    url: `https://api.frankfurter.app/${candidateDate}?from=${currency}&to=${baseCurrency}`,
    read: (data) => readFrankfurterRate(data, currency, baseCurrency, requestedDate),
  },
  {
    source: 'FAWAZ_CURRENCY_API',
    url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${candidateDate}/v1/currencies/${currency.toLowerCase()}.json`,
    read: (data) => readFawazRate(data, currency, baseCurrency, requestedDate),
  },
];

/**
 * 거래일/평가일의 외화 1단위를 KRW로 환산한다. 휴일이면 제공자가 돌려준 과거
 * 영업일을 우선 사용하고, 값 자체가 없을 때만 날짜를 하루씩 뒤로 이동한다.
 */
export const getHistoricalFxRate = async (
  currency,
  baseCurrency = 'KRW',
  date,
  options = {},
) => {
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  const normalizedBase = String(baseCurrency || '').trim().toUpperCase();
  const requestedDate = String(date || '').slice(0, 10);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const maxLookbackDays = Number.isInteger(options.maxLookbackDays)
    ? Math.max(0, options.maxLookbackDays)
    : DEFAULT_LOOKBACK_DAYS;

  if (!normalizedCurrency || !normalizedBase || !DATE_PATTERN.test(requestedDate)) return null;
  if (normalizedCurrency === normalizedBase) {
    return {
      currency: normalizedCurrency,
      baseCurrency: normalizedBase,
      requestedDate,
      rateDate: requestedDate,
      rate: 1,
      source: 'BASE_CURRENCY',
    };
  }
  if (typeof fetchImpl !== 'function') return null;

  for (let offset = 0; offset <= maxLookbackDays; offset += 1) {
    const candidateDate = shiftDate(requestedDate, -offset);
    if (!candidateDate) return null;

    for (const provider of providerRequests(
      normalizedCurrency,
      normalizedBase,
      candidateDate,
      requestedDate,
    )) {
      if (!hasRequestBudget(options.requestBudget)) return null;
      const data = await fetchJson(fetchImpl, provider.url, timeoutMs, options.requestBudget);
      const result = data ? provider.read(data) : null;
      if (result) return result;
    }
  }

  return null;
};
