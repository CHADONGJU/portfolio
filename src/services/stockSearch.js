import { getTargetItemCurrency, normalizeInputTicker } from '../utils/currencies.js';
import { fetchWithSafeProxy } from './marketData.js';

// Yahoo search results do not always include currency. Keep international
// exchange suffixes: removing them can silently select a different security.
const EXCHANGE_CURRENCIES = {
  T: 'JPY', HK: 'HKD', L: 'GBP', TO: 'CAD', V: 'CAD', AX: 'AUD',
  PA: 'EUR', DE: 'EUR', F: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR',
  SW: 'CHF', SS: 'CNY', SZ: 'CNY', SI: 'SGD', TW: 'TWD', TWO: 'TWD',
  NS: 'INR', BO: 'INR',
};

export const getSearchStockCurrency = (categoryId, ticker = '', reportedCurrency = '') => {
  if (categoryId === '국내주식') return 'KRW';
  const suffix = ticker.includes('.') ? ticker.split('.').at(-1).toUpperCase() : '';
  const normalizedCurrency = reportedCurrency === 'GBp' ? 'GBP' : reportedCurrency.toUpperCase();
  const currencyHint = /^[A-Z]{3}$/.test(normalizedCurrency)
    ? normalizedCurrency
    : (EXCHANGE_CURRENCIES[suffix] || '');
  return getTargetItemCurrency(categoryId, ticker, currencyHint);
};

const normalizeSearchTicker = (ticker, categoryId) => {
  const normalized = normalizeInputTicker(ticker);
  if (categoryId === '국내주식') return normalized.replace(/\.(KS|KQ)$/, '');
  return normalized.replace(/^(\d{4})\.T$/, '$1');
};

export const isTargetStockAlreadyAdded = (asset, existingItems = [], categoryId) => {
  const ticker = normalizeSearchTicker(asset?.ticker || '', categoryId);
  const name = String(asset?.name || '').trim().toLocaleLowerCase('ko');
  return existingItems.some((item) => {
    const itemTicker = normalizeSearchTicker(item?.ticker || '', categoryId);
    // Compare names only when a ticker is missing; different exchanges may use
    // identical names for different securities.
    if (ticker && itemTicker) return ticker === itemTicker;
    return Boolean(name) && String(item?.name || '').trim().toLocaleLowerCase('ko') === name;
  });
};

export const parseStockSearchResults = (payload, categoryId) => {
  if (!Array.isArray(payload?.quotes)) return [];
  const seen = new Set();
  return payload.quotes.flatMap((quote) => {
    if (!quote || !['EQUITY', 'ETF'].includes(quote.quoteType)) return [];
    const symbol = typeof quote.symbol === 'string' ? quote.symbol.trim().toUpperCase() : '';
    if (!symbol || !/^[A-Z0-9^][A-Z0-9.^=-]*$/.test(symbol)) return [];
    const domestic = /^\d{6}\.(KS|KQ)$/.test(symbol);
    if ((categoryId === '국내주식') !== domestic) return [];
    const ticker = domestic ? symbol.replace(/\.(KS|KQ)$/, '') : symbol;
    if (seen.has(ticker)) return [];
    seen.add(ticker);
    const name = [quote.longname, quote.shortname, ticker].find((value) => typeof value === 'string' && value.trim()).trim();
    const rawCurrency = typeof quote.currency === 'string' ? quote.currency : '';
    const currency = getSearchStockCurrency(categoryId, ticker, rawCurrency);
    return [{
      id: `search-${ticker}`,
      name,
      ticker,
      currency,
      exchange: String(quote.exchDisp || quote.exchange || ''),
    }];
  });
};

export const searchTargetStocks = async (query, categoryId) => {
  const term = String(query || '').trim();
  if (!term) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(term)}&quotesCount=20&newsCount=0&enableFuzzyQuery=false`;
  const payload = await fetchWithSafeProxy(url);
  if (!Array.isArray(payload?.quotes)) throw new Error('종목 검색에 연결하지 못했어요. 잠시 후 다시 검색하거나 직접 입력해 주세요.');
  return parseStockSearchResults(payload, categoryId);
};
