export const fetchKrwRateQuote = async (currency = 'USD') => {
  const baseCurrency = String(currency || 'USD').toUpperCase();
  if (baseCurrency === 'KRW') return {
    rate: 1,
    source: 'native-krw',
    asOf: new Date().toISOString(),
  };

  try {
    const primary = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
    if (primary.ok) {
      const data = await primary.json();
      if (Number(data?.rates?.KRW) > 0) return {
        rate: Number(data.rates.KRW),
        source: 'open.er-api.com',
        asOf: data.time_last_update_utc
          ? new Date(data.time_last_update_utc).toISOString()
          : new Date().toISOString(),
      };
    }
  } catch {
    // Continue to the fallback provider.
  }

  try {
    const fallback = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`,
    );
    if (fallback.ok) {
      const data = await fallback.json();
      const rate = Number(data?.[baseCurrency.toLowerCase()]?.krw);
      if (rate > 0) return {
        rate,
        source: 'fawaz-currency-api',
        asOf: data.date ? new Date(`${data.date}T00:00:00Z`).toISOString() : new Date().toISOString(),
      };
    }
  } catch {
    // Let callers decide how to handle a missing rate.
  }

  return null;
};

export const fetchKrwRate = async (currency = 'USD') => (
  (await fetchKrwRateQuote(currency))?.rate ?? null
);

export const fetchUsdKrwRate = () => fetchKrwRate('USD');

export const fetchJpyKrwRate = () => fetchKrwRate('JPY');

export const fetchBitcoinPrices = async () => {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=krw,usd',
    );
    if (!response.ok) return { krw: null, usd: null };

    const data = await response.json();
    return {
      krw: data?.bitcoin?.krw ?? null,
      usd: data?.bitcoin?.usd ?? null,
    };
  } catch {
    return { krw: null, usd: null };
  }
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 7000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const JINA_PREFIX = 'https://r.jina.ai/http://';
const JINA_MARKDOWN_MARKER = 'Markdown Content:';
const DIVIDEND_CACHE_STORAGE_KEY = 'portfolio_market_dividend_cache_v3';
const DIVIDEND_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const dividendRequests = new Map();

const getJinaUrl = (url) => `${JINA_PREFIX}${url.replace(/^https?:\/\//, '')}`;

const unwrapJinaResponseText = (text = '') => {
  const source = String(text || '').trim();
  const markerIndex = source.indexOf(JINA_MARKDOWN_MARKER);
  return markerIndex >= 0
    ? source.slice(markerIndex + JINA_MARKDOWN_MARKER.length).trim()
    : source;
};

export const parseJinaJsonResponse = (text = '') => {
  const content = unwrapJinaResponseText(text);
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;

    try {
      return JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
  }
};

const readDividendCache = (ticker) => {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const cache = JSON.parse(window.localStorage.getItem(DIVIDEND_CACHE_STORAGE_KEY) || '{}');
    const entry = cache?.[ticker];
    if (!entry || Number(entry.expiresAt) <= Date.now()) return null;
    return entry.result || null;
  } catch {
    return null;
  }
};

const writeDividendCache = (ticker, result) => {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const now = Date.now();
    const currentCache = JSON.parse(window.localStorage.getItem(DIVIDEND_CACHE_STORAGE_KEY) || '{}');
    const cache = Object.fromEntries(
      Object.entries(currentCache || {})
        .filter(([, entry]) => Number(entry?.expiresAt) > now)
        .slice(-99),
    );
    cache[ticker] = {
      expiresAt: now + DIVIDEND_CACHE_TTL_MS,
      result,
    };
    window.localStorage.setItem(DIVIDEND_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // 저장 공간이 차거나 차단된 경우에도 네트워크 결과는 그대로 사용한다.
  }
};

const getSameOriginProxyUrl = (url) => {
  if (typeof window === 'undefined' || !window.location?.origin) return null;
  if (!import.meta.env?.DEV && import.meta.env?.VITE_MARKET_PROXY_ENABLED !== 'true') return null;
  return `/api/market-proxy?url=${encodeURIComponent(url)}`;
};

const fetchJsonp = (url, callbackParameter = '_callback', timeoutMs = 7000) => {
  if (typeof document === 'undefined' || typeof globalThis === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const callbackName = `__portfolioJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const target = new URL(url);
    let settled = false;

    const finish = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      script.remove();
      try {
        delete globalThis[callbackName];
      } catch {
        globalThis[callbackName] = undefined;
      }
      resolve(data || null);
    };

    target.searchParams.set(callbackParameter, callbackName);
    globalThis[callbackName] = finish;
    script.async = true;
    script.charset = 'euc-kr';
    script.src = target.toString();
    script.onerror = () => finish(null);

    const timeoutId = setTimeout(() => finish(null), timeoutMs);
    document.head.appendChild(script);
  });
};

export const fetchWithSafeProxy = async (url) => {
  const sameOriginProxyUrl = getSameOriginProxyUrl(url);
  const proxies = [
    sameOriginProxyUrl,
    url,
    getJinaUrl(url),
  ].filter(Boolean);

  for (const proxy of proxies) {
    try {
      const res = await fetchWithTimeout(proxy, { cache: 'no-store' });
      if (!res.ok) continue;

      const text = await res.text();
      const data = parseJinaJsonResponse(text);
      if (!data) continue;

      if (data?.contents) {
        try {
          return JSON.parse(data.contents);
        } catch {
          continue;
        }
      }

      return data;
    } catch {
      continue;
    }
  }

  return null;
};

export const fetchTextWithSafeProxy = async (url) => {
  const sameOriginProxyUrl = getSameOriginProxyUrl(url);
  const proxies = [
    sameOriginProxyUrl,
    url,
    getJinaUrl(url),
  ].filter(Boolean);

  for (const proxy of proxies) {
    try {
      const res = await fetchWithTimeout(proxy, { cache: 'no-store' });
      if (!res.ok) continue;

      const text = await res.text();

      try {
        const data = JSON.parse(text);
        if (typeof data?.contents === 'string') return data.contents;
      } catch {
        return unwrapJinaResponseText(text);
      }
    } catch {
      continue;
    }
  }

  return null;
};

export const fetchUsdKrwRateQuoteByDate = async (date) => {
  if (!date) return null;

  const today = new Date().toISOString().split('T')[0];
  if (date >= today) return fetchKrwRateQuote('USD');

  const historicalSources = [
    {
      url: `https://api.frankfurter.app/${date}?from=USD&to=KRW`,
      source: 'frankfurter.app',
    },
    {
      url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
      source: 'fawaz-currency-api',
    },
  ];

  for (const { url, source } of historicalSources) {
    try {
      const data = await fetchWithSafeProxy(url);
      if (!data) continue;
      const rate = data?.rates?.KRW ?? data?.usd?.krw;
      if (Number.isFinite(Number(rate)) && Number(rate) > 0) return {
        rate: Number(rate),
        source,
        asOf: String(data?.date || date),
      };
    } catch {
      continue;
    }
  }

  return null;
};

export const fetchUsdKrwRateByDate = async (date) => (
  (await fetchUsdKrwRateQuoteByDate(date))?.rate ?? null
);

const normalizeTicker = (ticker) => ticker
  .toUpperCase()
  .trim()
  .replace(/^NASDAQ:/, '')
  .replace(/^NYSE:/, '')
  .replace(/^AMEX:/, '')
  .replace(/^TYO:/, '')
  .replace(/^TSE:/, '')
  .replace(/^JP:/, '')
  .replace(/\.JP$/, '.T')
  .replace(/\.TYO$/, '.T')
  .replace(/\s+/g, '');

const normalizeCategory = (category = '') => String(category || '').trim();

const isDomesticCategory = (category = '') => normalizeCategory(category) === '국내주식';

const isOverseasCategory = (category = '') => normalizeCategory(category) === '해외주식';

const TRADINGVIEW_SCANNER_URL = 'https://scanner.tradingview.com/global/scan';
const TRADINGVIEW_COLUMNS = [
  'name',
  'close',
  'rtc',
  'currency',
  'exchange',
  'type',
  'update_mode',
  'premarket_close',
  'postmarket_close',
  'premarket_time',
  'postmarket_time',
];
const TRADINGVIEW_US_EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX', 'CBOE', 'BATS', 'OTC'];
const TRADINGVIEW_EXCHANGE_ALIASES = {
  ARCA: 'AMEX',
  NYSEARCA: 'AMEX',
  NASDAQGS: 'NASDAQ',
  NASDAQGM: 'NASDAQ',
  NASDAQCM: 'NASDAQ',
  TYO: 'TSE',
};
const TRADINGVIEW_SUFFIX_MARKETS = [
  { suffix: '.T', exchange: 'TSE' },
  { suffix: '.L', exchange: 'LSE' },
  { suffix: '.TO', exchange: 'TSX' },
  { suffix: '.V', exchange: 'TSXV' },
  { suffix: '.AX', exchange: 'ASX' },
  { suffix: '.HK', exchange: 'HKEX' },
  { suffix: '.KS', exchange: 'KRX' },
  { suffix: '.KQ', exchange: 'KRX' },
  { suffix: '.DE', exchange: 'XETR' },
  { suffix: '.PA', exchange: 'EURONEXT' },
  { suffix: '.AS', exchange: 'EURONEXT' },
  { suffix: '.SW', exchange: 'SIX' },
];
const TRADINGVIEW_BATCH_SIZE = 240;

const normalizeTradingViewExchange = (exchange = '') => {
  const normalized = String(exchange || '').toUpperCase().trim();
  return TRADINGVIEW_EXCHANGE_ALIASES[normalized] || normalized;
};

export const getTradingViewSymbolCandidates = (asset = {}) => {
  const rawTicker = String(asset.ticker || '').toUpperCase().trim().replace(/\s+/g, '');
  const explicitMarket = rawTicker.match(/^([A-Z0-9_]+):(.+)$/);
  if (explicitMarket) {
    const exchange = normalizeTradingViewExchange(explicitMarket[1]);
    return exchange ? [`${exchange}:${explicitMarket[2]}`] : [];
  }

  const ticker = normalizeTicker(rawTicker).replace(/\.US$/, '');
  if (!ticker) return [];

  const suffixMarket = TRADINGVIEW_SUFFIX_MARKETS.find(({ suffix }) => ticker.endsWith(suffix));
  if (suffixMarket) {
    return [`${suffixMarket.exchange}:${ticker.slice(0, -suffixMarket.suffix.length)}`];
  }

  if (
    isDomesticCategory(asset.category)
    || (!isOverseasCategory(asset.category) && asset.currency === 'KRW')
    || /^\d{5,6}$/.test(ticker)
  ) {
    return [`KRX:${ticker}`];
  }

  if (
    asset.currency === 'JPY'
    || (/^\d{4}$/.test(ticker) && isOverseasCategory(asset.category))
  ) {
    return [`TSE:${ticker}`];
  }

  return TRADINGVIEW_US_EXCHANGES.map((exchange) => `${exchange}:${ticker}`);
};

export const readTradingViewQuote = (row) => {
  const values = row?.d;
  if (!row?.s || !Array.isArray(values)) return null;

  const [
    name,
    close,
    realtimeClose,
    currency,
    exchange,
    securityType,
    updateMode,
    premarketClose,
    postmarketClose,
    premarketTime,
    postmarketTime,
  ] = values;
  const regularPrice = Number(close);
  const realtimePrice = Number(realtimeClose);
  const premarketPrice = Number(premarketClose);
  const postmarketPrice = Number(postmarketClose);
  const safeRealtimePrice = Number.isFinite(realtimePrice) && realtimePrice > 0
    ? realtimePrice
    : null;
  const price = safeRealtimePrice ?? regularPrice;
  if (!Number.isFinite(price) || price <= 0) return null;

  const delaySeconds = Number(String(updateMode || '').match(/_(\d+)$/)?.[1]) || 0;
  const premarketTimestamp = Number(premarketTime) || 0;
  const postmarketTimestamp = Number(postmarketTime) || 0;
  const pricesMatch = (left, right) => (
    Number.isFinite(left)
    && left > 0
    && Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.0000001)
  );
  let baseSession = 'REGULAR';

  if (
    safeRealtimePrice !== null
    && pricesMatch(premarketPrice, safeRealtimePrice)
    && premarketTimestamp > postmarketTimestamp
  ) {
    baseSession = 'PRE_MARKET';
  } else if (
    safeRealtimePrice !== null
    && pricesMatch(postmarketPrice, safeRealtimePrice)
    && postmarketTimestamp >= premarketTimestamp
  ) {
    baseSession = 'POST_MARKET';
  }

  const delayMinutes = delaySeconds > 0 ? Math.round(delaySeconds / 60) : 0;
  const session = delayMinutes > 0
    ? `${baseSession}_DELAYED_${delayMinutes}_MIN`
    : baseSession;

  return {
    price,
    currency: currency || undefined,
    symbol: row.s,
    source: 'tradingview',
    market: exchange || row.s.split(':')[0] || '',
    securityType: securityType || '',
    session,
    delaySeconds,
    // TradingView scanner의 세션 시각은 체결 시각이 아니라 장 시작/종료 경계다.
    // 실제 체결 시각처럼 오인되지 않도록 별도 시각을 표시하지 않는다.
    asOf: null,
    name: name || '',
  };
};

const fetchTradingViewRows = async (symbols = []) => {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
  if (uniqueSymbols.length === 0) return [];

  const rows = [];
  for (let start = 0; start < uniqueSymbols.length; start += TRADINGVIEW_BATCH_SIZE) {
    const chunk = uniqueSymbols.slice(start, start + TRADINGVIEW_BATCH_SIZE);
    try {
      const response = await fetchWithTimeout(TRADINGVIEW_SCANNER_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify({
          symbols: {
            tickers: chunk,
            query: { types: [] },
          },
          columns: TRADINGVIEW_COLUMNS,
        }),
        cache: 'no-store',
      });
      if (!response.ok) continue;

      const data = await response.json();
      if (Array.isArray(data?.data)) rows.push(...data.data);
    } catch {
      continue;
    }
  }

  return rows;
};

export const fetchTradingViewQuotes = async (assets = []) => {
  const candidatesByAsset = assets.map((asset) => getTradingViewSymbolCandidates(asset));
  const rows = await fetchTradingViewRows(candidatesByAsset.flat());
  const fetchedAt = new Date();
  const quoteBySymbol = new Map(
    rows
      .map((row) => [row.s, readTradingViewQuote(row, fetchedAt)])
      .filter(([, quote]) => quote !== null),
  );

  return candidatesByAsset.map((candidates) => (
    candidates.map((candidate) => quoteBySymbol.get(candidate)).find(Boolean) || null
  ));
};

const fetchTradingViewQuote = async (asset) => (
  (await fetchTradingViewQuotes([asset]))[0] || null
);

const getUsTickerAliases = (ticker) => {
  const cleanTicker = normalizeTicker(ticker);
  const aliases = [cleanTicker];
  const baseTicker = cleanTicker.replace(/\.US$/, '');

  if (baseTicker.includes('.')) aliases.push(baseTicker.replace(/\./g, '-'));
  if (baseTicker.includes('-')) aliases.push(baseTicker.replace(/-/g, '.'));
  if (baseTicker.includes('/')) aliases.push(baseTicker.replace(/\//g, '-'), baseTicker.replace(/\//g, '.'));

  if (cleanTicker.endsWith('.US')) aliases.push(cleanTicker.replace(/\.US$/, ''));
  else if (!cleanTicker.includes('.')) aliases.push(`${cleanTicker}.US`);

  return [...new Set(aliases)];
};

const pickMarketAwarePrice = (quote) => {
  if (!quote) return null;

  const candidates = [];
  const regularTime = Number(quote.regularMarketTime) || 0;
  const postTime = Number(quote.postMarketTime) || 0;
  const preTime = Number(quote.preMarketTime) || 0;
  const marketState = String(quote.marketState || '').toUpperCase();

  if (
    marketState.includes('POST')
    || (postTime > 0 && postTime >= regularTime)
  ) {
    candidates.push(quote.postMarketPrice);
  }
  if (
    marketState.includes('PRE')
    || (preTime > 0 && preTime >= regularTime)
  ) {
    candidates.push(quote.preMarketPrice);
  }

  candidates.push(
    quote.regularMarketPrice,
    quote.currentPrice,
    quote.previousClose,
    quote.postMarketPrice,
    quote.preMarketPrice,
  );

  const price = candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  return price === undefined ? null : Number(price);
};

const getYahooQuoteTiming = (quote, price) => {
  const sessions = [
    ['POST_MARKET', quote?.postMarketPrice, quote?.postMarketTime],
    ['PRE_MARKET', quote?.preMarketPrice, quote?.preMarketTime],
    ['REGULAR', quote?.regularMarketPrice ?? quote?.currentPrice, quote?.regularMarketTime],
  ];
  const matchedSession = sessions.find(([, sessionPrice]) => (
    Number.isFinite(Number(sessionPrice))
    && Number(sessionPrice) === Number(price)
  ));
  const timestamp = Number(matchedSession?.[2] ?? quote?.regularMarketTime) || 0;

  return {
    session: matchedSession?.[0] || 'REGULAR',
    asOf: timestamp ? new Date(timestamp * 1000).toISOString() : null,
  };
};

const readYahooPrice = (data) => {
  const meta = data?.chart?.result?.[0]?.meta;
  const quote = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const close = quote?.close?.findLast((value) => typeof value === 'number');
  const price = pickMarketAwarePrice(meta)
    ?? close
    ?? meta?.chartPreviousClose
    ?? null;

  return price === null ? null : {
    price,
    currency: meta?.currency,
    symbol: meta?.symbol,
    source: 'yahoo',
    ...getYahooQuoteTiming(meta, price),
  };
};

export const readYahooQuotePrice = (data) => {
  const quote = data?.quoteResponse?.result?.[0];
  const price = pickMarketAwarePrice(quote);

  return price === null ? null : {
    price,
    currency: quote?.currency,
    symbol: quote?.symbol,
    source: 'yahoo',
    ...getYahooQuoteTiming(quote, price),
  };
};

const fetchYahooQuote = async (yfTicker) => {
  const urls = [
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
  ];

  for (const url of urls) {
    const quote = readYahooQuotePrice(await fetchWithSafeProxy(url));
    if (quote !== null) return quote;
  }

  return null;
};

const isDomesticStock = (asset, ticker) => {
  if (isOverseasCategory(asset.category || '')) return false;
  return isDomesticCategory(asset.category || '') || /^\d{5,6}(\.(KS|KQ))?$/.test(ticker);
};

const parseNaverPrice = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const readNaverQuote = (data) => {
  const item = data?.result?.areas?.[0]?.datas?.[0];
  if (!item) return null;

  const overMarketInfo = item.nxtOverMarketPriceInfo;
  const overPrice = parseNaverPrice(overMarketInfo?.overPrice);
  const regularPrice = parseNaverPrice(item.nv);
  const regularMarketStatus = String(item.ms || '').toUpperCase();
  const hasCompletedOverMarketPrice = Boolean(
    overPrice
    && overMarketInfo?.localTradedAt
    && ['OPEN', 'CLOSE'].includes(overMarketInfo?.overMarketStatus)
    && regularMarketStatus !== 'OPEN'
  );

  const price = hasCompletedOverMarketPrice ? overPrice : regularPrice;
  if (price === null) return null;
  const resultTime = Number(data?.result?.time);
  const regularAsOf = Number.isFinite(resultTime) && resultTime > 0
    ? new Date(resultTime).toISOString()
    : null;

  return {
    price,
    currency: 'KRW',
    symbol: item.cd || '',
    source: 'naver',
    session: hasCompletedOverMarketPrice
      ? overMarketInfo.tradingSessionType || 'AFTER_MARKET'
      : 'REGULAR',
    asOf: hasCompletedOverMarketPrice
      ? overMarketInfo.localTradedAt
      : regularAsOf,
  };
};

const toStooqSymbol = (ticker) => {
  const cleanTicker = normalizeTicker(ticker).replace(/\./g, '-').toLowerCase();
  if (cleanTicker.includes('.')) return cleanTicker;
  return `${cleanTicker}.us`;
};

const getStooqSymbols = (asset, ticker) => {
  const cleanTicker = normalizeTicker(ticker);

  if (/^\d{4}$/.test(cleanTicker) && (asset.currency === 'JPY' || isOverseasCategory(asset.category || ''))) {
    return [`${cleanTicker}.jp`];
  }

  if (cleanTicker.endsWith('.T')) return [cleanTicker.replace(/\.T$/, '.jp').toLowerCase()];
  if (cleanTicker.includes('.')) {
    const [, suffix = ''] = cleanTicker.match(/\.([A-Z]+)$/) || [];
    if (suffix.length > 1) return [cleanTicker.toLowerCase()];
    return [`${cleanTicker.replace(/\./g, '-').toLowerCase()}.us`];
  }

  return getUsTickerAliases(cleanTicker).map(toStooqSymbol);
};

const readStooqPrice = (csv) => {
  if (!csv) return null;

  const lines = csv.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.toLowerCase().startsWith('symbol,date,time,'));
  const row = headerIndex >= 0 ? lines[headerIndex + 1] : lines[1];
  if (!row) return null;

  const columns = row.split(',');
  const close = Number(columns[6]);

  return Number.isFinite(close) && close > 0 ? close : null;
};

const getYahooTickers = (asset, ticker) => {
  if (isDomesticStock(asset, ticker)) {
    if (ticker.includes('.')) return [ticker];
    return [`${ticker}.KS`, `${ticker}.KQ`];
  }

  if (ticker.includes('.')) {
    if (/\.(KS|KQ|T)$/i.test(ticker)) return [ticker];
    return getUsTickerAliases(ticker).map((symbol) => symbol.replace(/\.US$/, ''));
  }

  const candidates = [];

  if (/^\d{4}$/.test(ticker) && isOverseasCategory(asset.category || '')) {
    candidates.push(`${ticker}.T`);
  }

  candidates.push(ticker);

  getUsTickerAliases(ticker).forEach((symbol) => {
    candidates.push(symbol.replace(/\.US$/, ''));
  });

  return [...new Set(candidates)];
};

const fetchYahooChartQuote = async (yfTicker) => {
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=false`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=false`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1d&range=5d`,
  ];

  for (const url of urls) {
    const quote = readYahooPrice(await fetchWithSafeProxy(url));
    if (quote !== null) return quote;
  }

  return fetchYahooQuote(yfTicker);
};

const fetchStooqQuote = async (asset, ticker) => {
  for (const symbol of getStooqSymbols(asset, ticker)) {
    const stooqUrl = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
    const stooqPrice = readStooqPrice(await fetchTextWithSafeProxy(stooqUrl));
    if (stooqPrice !== null) return {
      price: stooqPrice,
      currency: symbol.endsWith('.jp') ? 'JPY' : asset.currency || 'USD',
      symbol,
      source: 'stooq',
      asOf: null,
    };
  }

  return null;
};

export const fetchStockQuote = async (asset) => {
  const ticker = normalizeTicker(asset.ticker);
  if (!ticker) return null;

  if (isDomesticStock(asset, ticker)) {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    if (cleanTicker) {
      const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}&_=${Date.now()}`;
      const data = await fetchJsonp(naverUrl) ?? await fetchWithSafeProxy(naverUrl);
      const naverQuote = readNaverQuote(data);
      if (naverQuote !== null) return naverQuote;
    }

    const tradingViewQuote = await fetchTradingViewQuote(asset);
    if (tradingViewQuote !== null) return tradingViewQuote;

    for (const yfTicker of getYahooTickers(asset, ticker)) {
      const yahooQuote = await fetchYahooChartQuote(yfTicker);
      if (yahooQuote !== null) return {
        ...yahooQuote,
        currency: yahooQuote.currency || 'KRW',
      };
    }
  }

  const tradingViewQuote = await fetchTradingViewQuote(asset);
  if (tradingViewQuote !== null) return tradingViewQuote;

  if (asset.currency === 'USD' || asset.currency === 'JPY' || isOverseasCategory(asset.category || '')) {
    for (const yfTicker of getYahooTickers(asset, ticker)) {
      const yahooQuote = await fetchYahooChartQuote(yfTicker);
      if (yahooQuote !== null) return yahooQuote;
    }

    return fetchStooqQuote(asset, ticker);
  }

  const yahooTickers = getYahooTickers(asset, ticker);

  const yahooUrls = yahooTickers.flatMap((yfTicker) => [
    {
      url: `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=false`,
      reader: readYahooPrice,
    },
    {
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=false`,
      reader: readYahooPrice,
    },
    {
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1d&range=5d`,
      reader: readYahooPrice,
    },
    {
      url: `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
      reader: readYahooQuotePrice,
    },
  ]);

  for (const { url, reader } of yahooUrls) {
    const yfData = await fetchWithSafeProxy(url);
    const yfQuote = reader(yfData);
    if (yfQuote !== null) return yfQuote;
  }

  return null;
};

export const fetchStockPrice = async (asset) => {
  const quote = await fetchStockQuote(asset);
  return quote?.price ?? null;
};

const getDividendTickers = (input) => {
  const withFallbacks = (symbols = []) => {
    const expanded = symbols.flatMap((symbol) => {
      const cleanSymbol = normalizeTicker(symbol);
      const baseSymbol = cleanSymbol.replace(/\.US$/, '');
      return cleanSymbol === baseSymbol ? [cleanSymbol] : [cleanSymbol, baseSymbol];
    });

    return expanded.filter(Boolean).filter((symbol, index, allSymbols) => allSymbols.indexOf(symbol) === index);
  };

  if (typeof input === 'string') return withFallbacks([input]);

  const ticker = normalizeTicker(input?.ticker || '');
  if (!ticker) return [];

  return withFallbacks([
    ticker,
    ...getYahooTickers(input, ticker),
  ]);
};

const normalizePublicDividendDate = (value = '') => {
  const rawDate = String(value || '').trim();
  if (!rawDate || rawDate === '—' || rawDate === '-') return '';
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? new Date(`${rawDate}T00:00:00Z`)
    : new Date(`${rawDate} UTC`);
  return Number.isFinite(parsedDate.getTime())
    ? parsedDate.toISOString().slice(0, 10)
    : '';
};

export const parseStockAnalysisDividends = (text = '') => {
  const dividends = {};

  unwrapJinaResponseText(text).split(/\r?\n/).forEach((line) => {
    if (!line.trim().startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) return;

    const exDate = normalizePublicDividendDate(cells[0]);
    const amount = Number(cells[1].replace(/[^0-9.-]/g, ''));
    if (!exDate || !Number.isFinite(amount) || amount <= 0) return;

    const timestamp = Math.floor(new Date(`${exDate}T00:00:00Z`).getTime() / 1000);
    dividends[timestamp] = {
      date: timestamp,
      amount,
      recordDate: normalizePublicDividendDate(cells[2]),
      paymentDate: normalizePublicDividendDate(cells[3]),
    };
  });

  return dividends;
};

const runDividendRequest = async (key, requestFactory) => {
  let request = dividendRequests.get(key);
  if (!request) {
    request = requestFactory().finally(() => dividendRequests.delete(key));
    dividendRequests.set(key, request);
  }
  return request;
};

const fetchStockAnalysisDividends = async (input, ticker) => {
  const isUsdListing = typeof input === 'object'
    && String(input?.currency || input?.originalCurrency || '').toUpperCase() === 'USD';
  const cleanTicker = normalizeTicker(ticker).replace(/\.US$/, '');
  if (!isUsdListing || !/^[A-Z0-9./-]+$/.test(cleanTicker)) return null;

  const securityType = String(input?.securityType || '').toUpperCase();
  const pathType = securityType.includes('ETF') || securityType.includes('FUND') ? 'etf' : 'stocks';
  const sourceUrl = `https://stockanalysis.com/${pathType}/${cleanTicker.toLowerCase()}/dividend/`;

  return runDividendRequest(`stockanalysis:${pathType}:${cleanTicker}`, async () => {
    try {
      const response = await fetchWithTimeout(getJinaUrl(sourceUrl), {
        cache: 'no-store',
        headers: { Accept: 'text/plain' },
      }, 15000);
      if (!response.ok) return null;

      const text = await response.text();
      const content = unwrapJinaResponseText(text);
      if (!/Dividend (Information|History)/i.test(content)) return null;

      const dividends = parseStockAnalysisDividends(content);
      return {
        status: Object.keys(dividends).length > 0 ? 'success' : 'empty',
        dividends,
        source: 'stockanalysis-via-jina',
        sourceTicker: cleanTicker,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  });
};

const fetchYahooDividends = async (yfTicker) => (
  runDividendRequest(`yahoo:${yfTicker}`, async () => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1mo&range=5y&events=div`;
    try {
      const response = await fetchWithTimeout(getJinaUrl(yahooUrl), {
        cache: 'no-store',
        headers: { Accept: 'text/plain' },
      }, 15000);
      if (!response.ok) return null;

      const data = parseJinaJsonResponse(await response.text());
      const chartResult = data?.chart?.result?.[0];
      if (!chartResult) return null;

      const dividends = chartResult.events?.dividends || {};
      return {
        status: Object.keys(dividends).length > 0 ? 'success' : 'empty',
        dividends,
        source: 'yahoo-via-jina',
        sourceTicker: yfTicker,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  })
);

export const fetchDividends = async (input) => {
  const tickers = getDividendTickers(input);
  const primaryTicker = tickers[0];
  if (!primaryTicker) {
    return {
      status: 'error',
      dividends: {},
      source: '',
      sourceTicker: '',
      fetchedAt: null,
    };
  }

  const forceRefresh = typeof input === 'object' && input?.forceRefresh === true;
  const cachedResult = forceRefresh ? null : readDividendCache(primaryTicker);
  if (cachedResult) return cachedResult;

  const stockAnalysisResult = await fetchStockAnalysisDividends(input, primaryTicker);
  if (stockAnalysisResult) {
    writeDividendCache(primaryTicker, stockAnalysisResult);
    return stockAnalysisResult;
  }

  let emptyResult = null;

  for (const yfTicker of tickers) {
    const result = await fetchYahooDividends(yfTicker);
    if (!result) continue;
    if (result.status === 'success') {
      writeDividendCache(primaryTicker, result);
      return result;
    }
    emptyResult ??= result;
  }

  if (emptyResult) writeDividendCache(primaryTicker, emptyResult);

  return emptyResult || {
    status: 'error',
    dividends: {},
    source: 'yahoo-via-jina',
    sourceTicker: '',
    fetchedAt: null,
  };
};
