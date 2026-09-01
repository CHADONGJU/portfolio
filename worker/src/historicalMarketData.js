import { getYahooTickers } from '../../src/services/marketData.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOSE_BUFFER_MINUTES = {
  'America/New_York': (16 * 60) + 15,
  'Asia/Seoul': (15 * 60) + 45,
  'Asia/Tokyo': (15 * 60) + 45,
};

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getZonedParts = (date, timeZone) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]),
);

const getZonedDateKey = (date, timeZone) => {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isWeekend = (dateKey) => {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

const consumeRequestBudget = (budget) => {
  if (!budget || !Number.isFinite(Number(budget.remaining))) return true;
  if (Number(budget.remaining) <= 0) return false;
  budget.remaining = Number(budget.remaining) - 1;
  return true;
};

export const isMarketCloseFinalized = ({
  targetDate,
  timeZone,
  now = new Date(),
} = {}) => {
  if (!DATE_PATTERN.test(String(targetDate || '')) || !timeZone) return false;
  const parts = getZonedParts(now, timeZone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (localDate > targetDate) return true;
  if (localDate < targetDate) return false;
  const cutoffMinutes = CLOSE_BUFFER_MINUTES[timeZone] ?? (17 * 60);
  return (Number(parts.hour) * 60) + Number(parts.minute) >= cutoffMinutes;
};

/** Yahoo 일봉에서 정규장 close와 실제 거래일을 함께 읽는다. */
export const readYahooHistoricalClose = (data, targetDate, options = {}) => {
  const result = data?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timeZone = result?.meta?.exchangeTimezoneName || 'UTC';
  const bars = timestamps.map((timestamp, index) => ({
    priceDate: getZonedDateKey(new Date(Number(timestamp) * 1000), timeZone),
    price: Number(closes[index]),
  })).filter((bar) => DATE_PATTERN.test(bar.priceDate) && bar.price > 0)
    .filter((bar) => bar.priceDate <= targetDate)
    .sort((left, right) => left.priceDate.localeCompare(right.priceDate));
  const exact = bars.find((bar) => bar.priceDate === targetDate);
  const fallback = bars.at(-1);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const marketClosed = isMarketCloseFinalized({ targetDate, timeZone, now });

  if (exact) {
    return {
      ...exact,
      currency: result?.meta?.currency || '',
      exchangeTimezone: timeZone,
      marketDayStatus: 'trading-day',
      priceStatus: marketClosed ? 'confirmed-close' : 'pending-close',
      source: 'yahoo-historical',
    };
  }

  const explicitlyClosed = options.marketDayStatus === 'closed' || isWeekend(targetDate);
  if (fallback && explicitlyClosed) {
    return {
      ...fallback,
      currency: result?.meta?.currency || '',
      exchangeTimezone: timeZone,
      marketDayStatus: 'closed',
      priceStatus: 'confirmed-close-fallback',
      source: 'yahoo-historical',
    };
  }

  return fallback ? {
    ...fallback,
    currency: result?.meta?.currency || '',
    exchangeTimezone: timeZone,
    marketDayStatus: 'unknown',
    priceStatus: 'pending-close',
    source: 'yahoo-historical',
  } : null;
};

const fetchHistoricalClose = async (asset, targetDate, options = {}) => {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const ticker = String(asset?.ticker || '').trim().toUpperCase();
  if (!ticker || typeof fetchImpl !== 'function') return null;
  const period1 = Math.floor(new Date(`${shiftDate(targetDate, -14)}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${shiftDate(targetDate, 2)}T00:00:00Z`).getTime() / 1000);

  for (const candidate of getYahooTickers(asset, ticker)) {
    try {
      if (!consumeRequestBudget(options.requestBudget)) return null;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
      const response = await fetchImpl(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const quote = readYahooHistoricalClose(await response.json(), targetDate, options);
      if (quote) return { ...quote, symbol: candidate };
    } catch {
      continue;
    }
  }
  return null;
};

/** 현금은 null을 유지하고, 시장자산은 targetDate의 확정 일봉만 조회한다. */
export const fetchHistoricalCloseQuotes = async (assets = [], targetDate, options = {}) => {
  const quotes = [];
  const quoteCache = new Map();
  for (const asset of assets) {
    if (String(asset?.category || '').trim() === '현금') quotes.push(null);
    else {
      const ticker = String(asset?.ticker || '').trim().toUpperCase();
      const signature = getYahooTickers(asset, ticker).join('|');
      if (!quoteCache.has(signature)) {
        quoteCache.set(signature, fetchHistoricalClose(asset, targetDate, options));
      }
      quotes.push(await quoteCache.get(signature));
    }
  }
  return quotes;
};
