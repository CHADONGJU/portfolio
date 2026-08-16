/**
 * 환율 요청에 타임아웃이 없으면, 제공자가 연결만 받고 응답하지 않을 때 동기화 루프
 * 전체가 영원히 pending 상태로 멈춘다. 그러면 "실행 중" 플래그가 풀리지 않아
 * 페이지를 새로 열기 전까지 시세가 통째로 정지한다.
 */
const FX_TIMEOUT_MS = 8000;

export const fetchKrwRate = async (currency = 'USD') => {
  const baseCurrency = String(currency || 'USD').toUpperCase();
  if (baseCurrency === 'KRW') return 1;

  try {
    const primary = await fetchWithTimeout(
      `https://open.er-api.com/v6/latest/${baseCurrency}`,
      {},
      FX_TIMEOUT_MS,
    );
    if (primary.ok) {
      const data = await primary.json();
      if (data?.rates?.KRW) return data.rates.KRW;
    }
  } catch {
    // Continue to the fallback provider.
  }

  try {
    const fallback = await fetchWithTimeout(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`,
      {},
      FX_TIMEOUT_MS,
    );
    if (fallback.ok) {
      const data = await fallback.json();
      if (data?.[baseCurrency.toLowerCase()]?.krw) return data[baseCurrency.toLowerCase()].krw;
    }
  } catch {
    // Let callers decide how to handle a missing rate.
  }

  return null;
};

export const fetchUsdKrwRate = () => fetchKrwRate('USD');

export const fetchJpyKrwRate = () => fetchKrwRate('JPY');

// Yahoo는 런던 상장 종목을 펜스(GBp) 단위로 돌려준다.
// 통화 코드를 그대로 저장하면 대소문자 불일치로 환율이 1이 적용되므로
// 여기서 ISO 코드(대문자)와 기본 단위 가격으로 정규화한다.
const SUBUNIT_CURRENCIES = {
  GBX: { parent: 'GBP', divisor: 100 },
  ZAC: { parent: 'ZAR', divisor: 100 },
  ILA: { parent: 'ILS', divisor: 100 },
};

export const normalizeQuote = (price, currency, fallbackCurrency = '') => {
  const rawCurrency = String(currency || '').trim();
  const upperCurrency = rawCurrency.toUpperCase();
  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) return null;
  if (!upperCurrency) {
    // 통화를 모를 때 임의로 KRW를 박으면 호출부의 '자산 통화' 폴백이 죽는다.
    // fallback을 주지 않으면 undefined로 남겨 호출부가 판단하게 한다.
    const fallback = String(fallbackCurrency || '').trim().toUpperCase();
    return { price: numericPrice, currency: fallback || undefined };
  }

  // 'GBp'(소문자 p)만 펜스. 'GBP'는 파운드 그대로 둔다.
  const subunit = rawCurrency === 'GBp'
    ? { parent: 'GBP', divisor: 100 }
    : SUBUNIT_CURRENCIES[upperCurrency];

  if (subunit) return { price: numericPrice / subunit.divisor, currency: subunit.parent };

  return { price: numericPrice, currency: upperCurrency };
};

const PROXY_TIMEOUT_MS = 7000;
// 직접 호출은 짧게 끊고 프록시로 넘어간다.
const DIRECT_TIMEOUT_MS = 4000;
const PROXY_BATCH_SIZE = 3;
const MAX_QUOTE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DOMESTIC_QUOTE_TOLERANCE = 0.2;
const JINA_MARKDOWN_MARKER = 'Markdown Content:';
// 모든 배치가 실제로 시도될 수 있는 예산이어야 마지막 폴백(r.jina.ai)이 사문화되지 않는다.
// 직접 호출 4초 + 프록시 배치 3개 × 7초.
const PROXY_BUDGET_MS = DIRECT_TIMEOUT_MS + (PROXY_TIMEOUT_MS * 3);

const withCacheBuster = (url) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_=${Date.now()}`;
};

const normalizeProviderTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    const milliseconds = numericValue < 1e12 ? numericValue * 1000 : numericValue;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const isFreshQuoteTimestamp = (
  providerUpdatedAt,
  now = Date.now(),
  maxAgeMs = MAX_QUOTE_AGE_MS,
) => {
  const timestamp = normalizeProviderTimestamp(providerUpdatedAt);
  if (!timestamp) return false;

  const ageMs = Number(now) - new Date(timestamp).getTime();
  return ageMs >= -(5 * 60 * 1000) && ageMs <= maxAgeMs;
};

export const areDomesticQuotesConsistent = (
  firstQuote,
  secondQuote,
  tolerance = DOMESTIC_QUOTE_TOLERANCE,
) => {
  const firstPrice = Number(firstQuote?.price);
  const secondPrice = Number(secondQuote?.price);
  if (
    !Number.isFinite(firstPrice)
    || firstPrice <= 0
    || !Number.isFinite(secondPrice)
    || secondPrice <= 0
  ) return false;

  return Math.abs(firstPrice - secondPrice) / Math.max(firstPrice, secondPrice) <= tolerance;
};

export const selectValidatedDomesticQuote = (
  naverQuote,
  yahooQuote,
  now = Date.now(),
) => {
  const freshNaverQuote = isFreshQuoteTimestamp(naverQuote?.providerUpdatedAt, now)
    ? naverQuote
    : null;
  const freshYahooQuote = isFreshQuoteTimestamp(yahooQuote?.providerUpdatedAt, now)
    ? yahooQuote
    : null;

  if (freshNaverQuote && freshYahooQuote) {
    if (!areDomesticQuotesConsistent(freshNaverQuote, freshYahooQuote)) return null;

    return {
      ...freshNaverQuote,
      verified: true,
      validation: 'cross-provider',
      corroboratedBy: freshYahooQuote.source || 'yahoo',
    };
  }

  const singleFreshQuote = freshNaverQuote || freshYahooQuote;
  if (!singleFreshQuote) return null;

  return {
    ...singleFreshQuote,
    verified: false,
    validation: 'fresh-provider-timestamp',
  };
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = PROXY_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildProxyList = (url, { jinaFirst = false } = {}) => {
  const encodedUrl = encodeURIComponent(url);
  const bareUrl = url.replace(/^https?:\/\//, '');
  const jinaUrl = `https://r.jina.ai/http://${bareUrl}`;

  const rest = [
    jinaUrl,
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
    `https://corsproxy.io/?${encodedUrl}`,
    `https://corsproxy.io/?url=${encodedUrl}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  return jinaFirst ? [url, jinaUrl, ...rest.slice(1)] : [url, ...rest];
};

/**
 * 프록시를 순차로 8번 시도하면 실패 종목 하나가 수 분을 잡아먹는다.
 * 원본 URL을 먼저 짧게 시도하고(성공하면 가장 신선한 값), 실패하면
 * 프록시를 3개씩 동시에 던져 가장 먼저 파싱에 성공한 응답을 쓴다.
 * 종목당 전체 예산(budgetMs)을 넘기면 그대로 포기한다.
 */
const toBatches = ([direct, ...proxies]) => {
  // 원본 URL은 단독 배치로 둔다. 같이 던지면 캐시된 프록시 응답이 이길 수 있다.
  const batches = direct ? [[direct]] : [];
  for (let index = 0; index < proxies.length; index += PROXY_BATCH_SIZE) {
    batches.push(proxies.slice(index, index + PROXY_BATCH_SIZE));
  }
  return batches;
};

const fetchViaProxies = async (urls, parseText, budgetMs = PROXY_BUDGET_MS) => {
  const deadline = Date.now() + budgetMs;
  const batches = toBatches(urls);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;

    const isDirectAttempt = batchIndex === 0 && batches[0].length === 1;
    const attemptTimeoutMs = Math.min(
      remainingMs,
      isDirectAttempt ? DIRECT_TIMEOUT_MS : PROXY_TIMEOUT_MS,
    );

    const attempts = batches[batchIndex].map(async (url) => {
      const res = await fetchWithTimeout(url, { cache: 'no-store' }, attemptTimeoutMs);
      if (!res.ok) throw new Error(`request responded ${res.status}`);

      const parsed = parseText(await res.text());
      if (parsed === null || parsed === undefined) throw new Error('payload not usable');
      return parsed;
    });

    try {
      return await Promise.any(attempts);
    } catch {
      // 이 배치는 전부 실패했다. 예산이 남아 있으면 다음 배치를 시도한다.
    }
  }

  return null;
};

const unwrapJinaResponseText = (text = '') => {
  const source = String(text || '').trim();
  const markerIndex = source.indexOf(JINA_MARKDOWN_MARKER);
  return markerIndex >= 0
    ? source.slice(markerIndex + JINA_MARKDOWN_MARKER.length).trim()
    : source;
};

export const parseProxyJson = (text) => {
  let data;
  try {
    data = JSON.parse(unwrapJinaResponseText(text));
  } catch {
    const content = unwrapJinaResponseText(text);
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;

    try {
      data = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
  }

  if (data?.contents) {
    try {
      return JSON.parse(data.contents);
    } catch {
      return null;
    }
  }

  return data ?? null;
};

const parseProxyText = (text) => {
  if (!text) return null;

  try {
    const data = JSON.parse(text);
    // allorigins의 get 응답은 원문을 contents에 문자열로 담아준다.
    return typeof data?.contents === 'string' ? data.contents : null;
  } catch {
    // JSON이 아니면 원문 그대로가 우리가 원하던 텍스트(CSV 등)다.
    return unwrapJinaResponseText(text);
  }
};

export const fetchWithSafeProxy = async (url) => (
  fetchViaProxies(buildProxyList(url), parseProxyJson)
);

export const fetchTextWithSafeProxy = async (url) => (
  fetchViaProxies(buildProxyList(url, { jinaFirst: true }), parseProxyText)
);

export const fetchUsdKrwRateByDate = async (date) => {
  if (!date) return null;

  const today = new Date().toISOString().split('T')[0];
  if (date >= today) return fetchUsdKrwRate();

  const historicalUrls = [
    `https://api.frankfurter.app/${date}?from=USD&to=KRW`,
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
  ];

  for (const url of historicalUrls) {
    try {
      const response = await fetchWithTimeout(url, { cache: 'no-store' }, FX_TIMEOUT_MS);
      if (!response.ok) continue;

      const data = await response.json();
      const rate = data?.rates?.KRW ?? data?.usd?.krw;
      if (Number.isFinite(Number(rate)) && Number(rate) > 0) return Number(rate);
    } catch {
      continue;
    }
  }

  return null;
};

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
  const price = safeRealtimePrice
    ?? (Number.isFinite(regularPrice) && regularPrice > 0 ? regularPrice : null);
  if (price === null) return null;

  const delaySeconds = Number(String(updateMode || '').match(/_(\d+)$/)?.[1]) || 0;
  const premarketTimestamp = Number(premarketTime) || 0;
  const postmarketTimestamp = Number(postmarketTime) || 0;
  const pricesMatch = (left, right) => (
    Number.isFinite(left)
    && left > 0
    && Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.0000001)
  );
  let marketSession = 'REGULAR';

  if (
    safeRealtimePrice !== null
    && pricesMatch(premarketPrice, safeRealtimePrice)
    && premarketTimestamp > postmarketTimestamp
  ) {
    marketSession = 'PRE_MARKET';
  } else if (
    safeRealtimePrice !== null
    && pricesMatch(postmarketPrice, safeRealtimePrice)
    && postmarketTimestamp >= premarketTimestamp
  ) {
    marketSession = 'POST_MARKET';
  }

  const delayMinutes = delaySeconds > 0 ? Math.round(delaySeconds / 60) : 0;
  const session = delayMinutes > 0
    ? `${marketSession}_DELAYED_${delayMinutes}_MIN`
    : marketSession;

  return {
    price,
    currency: currency || undefined,
    symbol: row.s,
    source: 'tradingview',
    market: exchange || row.s.split(':')[0] || '',
    securityType: securityType || '',
    marketSession: session,
    delaySeconds,
    validation: 'direct-market-feed',
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
  const quoteBySymbol = new Map(
    rows
      .map((row) => [row.s, readTradingViewQuote(row)])
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

export const pickMarketAwarePrice = (quote) => {
  if (!quote) return null;

  const marketState = String(quote.marketState || '').toUpperCase();
  const candidates = marketState.startsWith('POST')
    ? [
      quote.postMarketPrice,
      quote.regularMarketPrice,
      quote.currentPrice,
      quote.preMarketPrice,
      quote.previousClose,
    ]
    : marketState.startsWith('PRE')
      ? [
        quote.preMarketPrice,
        quote.regularMarketPrice,
        quote.currentPrice,
        quote.postMarketPrice,
        quote.previousClose,
      ]
      : [
        quote.regularMarketPrice,
        quote.currentPrice,
        quote.postMarketPrice,
        quote.preMarketPrice,
        quote.previousClose,
      ];

  const price = candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  return price === undefined ? null : Number(price);
};

const readYahooPrice = (data) => {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const close = quote?.close?.findLast((value) => typeof value === 'number');
  const price = pickMarketAwarePrice(meta)
    ?? close
    ?? meta?.chartPreviousClose
    ?? null;

  if (price === null) return null;

  const normalized = normalizeQuote(price, meta?.currency);
  if (normalized === null) return null;

  const marketState = String(meta?.marketState || '').toUpperCase();
  const marketTimestamp = marketState.startsWith('POST')
    ? (meta?.postMarketTime || meta?.regularMarketTime)
    : marketState.startsWith('PRE')
      ? (meta?.preMarketTime || meta?.regularMarketTime)
      : meta?.regularMarketTime;
  const fallbackTimestamp = result?.timestamp?.findLast((value) => Number.isFinite(Number(value)));

  return {
    ...normalized,
    symbol: meta?.symbol,
    providerUpdatedAt: normalizeProviderTimestamp(marketTimestamp || fallbackTimestamp),
  };
};

const readYahooQuotePrice = (data) => {
  const quote = data?.quoteResponse?.result?.[0];
  const price = pickMarketAwarePrice(quote);

  if (price === null) return null;

  const normalized = normalizeQuote(price, quote?.currency);
  return normalized === null ? null : {
    ...normalized,
    symbol: quote?.symbol,
    providerUpdatedAt: normalizeProviderTimestamp(
      quote?.postMarketTime
      || quote?.preMarketTime
      || quote?.regularMarketTime,
    ),
  };
};

const fetchYahooQuote = async (yfTicker) => {
  const urls = [
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
  ];

  for (const url of urls) {
    const quote = readYahooQuotePrice(await fetchWithSafeProxy(withCacheBuster(url)));
    if (quote !== null) return { ...quote, source: 'yahoo' };
  }

  return null;
};

const isDomesticStock = (asset, ticker) => {
  if (isOverseasCategory(asset.category || '')) return false;
  return isDomesticCategory(asset.category || '') || /^\d{5,6}(\.(KS|KQ))?$/.test(ticker);
};

export const readNaverQuote = (data) => {
  const item = data?.result?.areas?.[0]?.datas?.[0];
  if (!item) return null;

  const overMarketInfo = item.nxtOverMarketPriceInfo;
  const overPrice = Number(String(overMarketInfo?.overPrice ?? '').replace(/,/g, ''));

  if (
    overMarketInfo?.overMarketStatus === 'OPEN'
    && Number.isFinite(overPrice)
    && overPrice > 0
  ) {
    return {
      price: overPrice,
      currency: 'KRW',
      source: 'naver',
      providerUpdatedAt: normalizeProviderTimestamp(
        overMarketInfo.localTradedAt || data?.result?.time,
      ),
      marketSession: overMarketInfo.tradingSessionType || 'AFTER_MARKET',
    };
  }

  const currentPrice = Number(item.nv);
  if (Number.isFinite(currentPrice) && currentPrice > 0) return {
    price: currentPrice,
    currency: 'KRW',
    source: 'naver',
    providerUpdatedAt: normalizeProviderTimestamp(data?.result?.time),
    marketSession: item.ms || 'REGULAR',
  };

  return null;
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
    `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=true`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=true`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1d&range=5d`,
  ];

  for (const url of urls) {
    const quote = readYahooPrice(await fetchWithSafeProxy(withCacheBuster(url)));
    if (quote !== null) return { ...quote, source: 'yahoo' };
  }

  return fetchYahooQuote(yfTicker);
};

const fetchFirstYahooChartQuote = async (tickers = []) => {
  const uniqueTickers = [...new Set(tickers.filter(Boolean))];
  if (uniqueTickers.length === 0) return null;

  try {
    return await Promise.any(uniqueTickers.map(async (ticker) => {
      const quote = await fetchYahooChartQuote(ticker);
      if (quote === null) throw new Error('quote unavailable');
      return quote;
    }));
  } catch {
    return null;
  }
};

const fetchStooqQuote = async (asset, ticker) => {
  for (const symbol of getStooqSymbols(asset, ticker)) {
    const stooqUrl = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
    const stooqPrice = readStooqPrice(await fetchTextWithSafeProxy(stooqUrl));
    if (stooqPrice !== null) {
      const normalized = normalizeQuote(
        stooqPrice,
        symbol.endsWith('.jp') ? 'JPY' : asset.currency || 'USD',
      );
      if (normalized !== null) return { ...normalized, symbol, source: 'stooq' };
    }
  }

  return null;
};

export const fetchStockQuote = async (asset) => {
  const ticker = normalizeTicker(asset.ticker);
  if (!ticker) return null;

  const tradingViewQuote = await fetchTradingViewQuote(asset);
  if (tradingViewQuote !== null) return tradingViewQuote;

  if (isDomesticStock(asset, ticker)) {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    const naverPromise = cleanTicker
      ? fetchWithSafeProxy(withCacheBuster(
        `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`,
      )).then(readNaverQuote)
      : Promise.resolve(null);
    const yahooPromise = fetchFirstYahooChartQuote(getYahooTickers(asset, ticker));
    const [naverQuote, yahooQuote] = await Promise.all([naverPromise, yahooPromise]);
    const validatedQuote = selectValidatedDomesticQuote(naverQuote, yahooQuote);

    if (validatedQuote !== null) return {
      ...validatedQuote,
      currency: validatedQuote.currency || 'KRW',
      symbol: validatedQuote.symbol || ticker,
    };

    // 여기까지 왔다면 국내 종목은 더 볼 곳이 없다.
    // return이 없으면 아래 블록이 같은 Yahoo URL을 한 번 더 돌게 된다.
    return null;
  }

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
      url: `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=true`,
      reader: readYahooPrice,
    },
    {
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=true`,
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
    if (yfQuote !== null) return { ...yfQuote, source: 'yahoo' };
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

const KNOWN_ETF_TICKERS = new Set(['JEPI', 'SPY']);
const dividendRequests = new Map();
const KNOWN_JPM_ADR_CUSIPS = new Map([
  ['NVO', '670100205'],
]);
const KNOWN_KODEX_FUND_IDS = new Map([
  ['453810', '2ETFJ1'],
  ['477730', '2ETFM6'],
]);
const KNOWN_TIGER_KSD_FUNDS = new Map([
  ['277630', 'KR7277630000'],
]);

export const getKnownKodexFundId = (ticker = '') => (
  KNOWN_KODEX_FUND_IDS.get(normalizeTicker(ticker).replace(/[^0-9]/g, '')) || ''
);

export const getKnownTigerKsdFund = (ticker = '') => (
  KNOWN_TIGER_KSD_FUNDS.get(normalizeTicker(ticker).replace(/[^0-9]/g, '')) || ''
);

export const requiresPaymentDateDividendSource = (input = {}) => (
  String(input?.originalCurrency || input?.currency || '').toUpperCase() === 'USD'
);

const normalizeCompactPublicDate = (value = '') => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
};

export const parseKodexDividends = (data = {}) => {
  const dividends = {};

  (Array.isArray(data?.dividList) ? data.dividList : []).forEach((row) => {
    const exDate = normalizeCompactPublicDate(row.basicD);
    const paymentDate = normalizeCompactPublicDate(row.payD);
    const amount = Number(row.dividA);
    if (!exDate || !Number.isFinite(amount) || amount <= 0) return;

    const timestamp = Math.floor(new Date(`${exDate}T00:00:00Z`).getTime() / 1000);
    dividends[timestamp] = {
      date: timestamp,
      amount,
      paymentDate,
      taxableBasePerShare: Math.max(0, Number(row.taxDividA) || 0),
      // 공식 분배금은 세전 현금분배금이다. 실제 즉시 원천징수 여부는
      // 자산에 저장된 일반계좌/ISA/연금계좌 유형으로 계산한다.
      sourceAmountIsNet: false,
      source: 'kodex',
    };
  });

  return dividends;
};

const fetchKodexDividends = async (input = {}, ticker = '') => {
  const currency = String(input?.originalCurrency || input?.currency || '').toUpperCase();
  const cleanTicker = normalizeTicker(ticker).replace(/[^0-9]/g, '');
  if (currency !== 'KRW' || !/^\d{6}$/.test(cleanTicker)) return null;

  const requestKey = `kodex:${cleanTicker}`;
  let request = dividendRequests.get(requestKey);
  if (!request) {
    request = (async () => {
      let fundId = getKnownKodexFundId(cleanTicker);
      if (!fundId) {
        const searchUrl = `https://www.samsungfund.com/api/v1/kodex/product.do?ordrColm=NAV&ordrSort=DESC&pageNo=1&srchTerm=w&srchVal=${cleanTicker}`;
        const products = await fetchWithSafeProxy(searchUrl);
        const product = (Array.isArray(products) ? products : [])
          .find((candidate) => String(candidate?.stkTicker || '') === cleanTicker);
        fundId = product?.fId || '';
      }
      if (!fundId) return null;

      const distributionUrl = `https://www.samsungfund.com/api/v1/kodex/divid-info.do?id=${encodeURIComponent(fundId)}`;
      let data = null;
      try {
        const jinaUrl = `https://r.jina.ai/http://${distributionUrl.replace(/^https?:\/\//, '')}`;
        const response = await fetchWithTimeout(jinaUrl, {
          cache: 'no-store',
          headers: { Accept: 'text/plain' },
        }, 20000);
        if (response.ok) data = parseProxyJson(await response.text());
      } catch {
        data = null;
      }
      if (!data) data = await fetchWithSafeProxy(distributionUrl);
      const dividends = parseKodexDividends(data);
      return Object.keys(dividends).length > 0 ? dividends : null;
    })().finally(() => dividendRequests.delete(requestKey));
    dividendRequests.set(requestKey, request);
  }

  return request;
};

const normalizeTigerDividendDate = (value = '') => {
  const normalized = String(value || '').trim().replace(/[./]/g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
};

const parseTigerDividendRow = (cells = [], dividends = {}) => {
  if (cells.length < 4) return;
  const recordDate = normalizeTigerDividendDate(cells[0]);
  const paymentDate = normalizeTigerDividendDate(cells[1]);
  const amount = Number(String(cells[2] || '').replace(/[^0-9.-]/g, ''));
  const taxableBasePerShare = Number(String(cells[3] || '').replace(/[^0-9.-]/g, ''));
  if (!recordDate || !paymentDate || !Number.isFinite(amount) || amount <= 0) return;

  const timestamp = Math.floor(new Date(`${recordDate}T00:00:00Z`).getTime() / 1000);
  dividends[timestamp] = {
    date: timestamp,
    recordDate,
    paymentDate,
    amount,
    taxableBasePerShare: Math.max(0, taxableBasePerShare || 0),
    // 공식 표의 분배금과 과세표준을 그대로 전달하고, 계좌 유형에 따른
    // 즉시 원천징수 여부는 포트폴리오 계산기가 결정한다.
    sourceAmountIsNet: false,
    source: 'tiger',
  };
};

export const parseTigerDividends = (text = '') => {
  const source = unwrapJinaResponseText(text);
  const dividends = {};

  // The official endpoint returns an HTML table directly. Jina's safe proxy can
  // also turn the same table into Markdown, so accept both representations.
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowPattern.exec(source);
  while (rowMatch) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => match[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').trim());
    parseTigerDividendRow(cells, dividends);
    rowMatch = rowPattern.exec(source);
  }

  source.split(/\r?\n/).forEach((line) => {
    if (!line.trim().startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    parseTigerDividendRow(cells, dividends);
  });

  return dividends;
};

const fetchTigerDividends = async (input = {}, ticker = '') => {
  const currency = String(input?.originalCurrency || input?.currency || '').toUpperCase();
  const cleanTicker = normalizeTicker(ticker).replace(/[^0-9]/g, '');
  const ksdFund = getKnownTigerKsdFund(cleanTicker);
  if (currency !== 'KRW' || !ksdFund) return null;

  const requestKey = `tiger:${cleanTicker}`;
  let request = dividendRequests.get(requestKey);
  if (!request) {
    request = (async () => {
      const sourceUrl = 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/refDivAjax.ajax'
        + `?pageIndex=1&firstIndex=0&listCnt=100&ksdFund=${encodeURIComponent(ksdFund)}`
        + `&jongName=${encodeURIComponent(input?.name || 'TIGER 코스피')}`;
      const content = await fetchTextWithSafeProxy(sourceUrl);
      if (!content) return null;
      const dividends = parseTigerDividends(content);
      return Object.keys(dividends).length > 0 ? dividends : null;
    })().finally(() => dividendRequests.delete(requestKey));
    dividendRequests.set(requestKey, request);
  }

  return request;
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
  let columnIndexes = null;

  unwrapJinaResponseText(text).split(/\r?\n/).forEach((line) => {
    if (!line.trim().startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) return;

    const normalizedHeaders = cells.map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ''));
    const exDateIndex = normalizedHeaders.findIndex((header) => header.includes('exdividenddate'));
    const amountIndex = normalizedHeaders.findIndex((header) => (
      header.includes('cashamount') || header.includes('dividendamount')
    ));
    if (exDateIndex >= 0 && amountIndex >= 0) {
      columnIndexes = {
        exDate: exDateIndex,
        amount: amountIndex,
        recordDate: normalizedHeaders.findIndex((header) => header.includes('recorddate')),
        paymentDate: normalizedHeaders.findIndex((header) => (
          header.includes('paydate') || header.includes('paymentdate')
        )),
      };
      return;
    }

    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return;

    const indexes = columnIndexes || {
      exDate: 0,
      amount: 1,
      recordDate: 2,
      paymentDate: 3,
    };

    const exDate = normalizePublicDividendDate(cells[indexes.exDate]);
    const amount = Number(String(cells[indexes.amount] || '').replace(/[^0-9.-]/g, ''));
    if (!exDate || !Number.isFinite(amount) || amount <= 0) return;

    const timestamp = Math.floor(new Date(`${exDate}T00:00:00Z`).getTime() / 1000);
    dividends[timestamp] = {
      date: timestamp,
      amount,
      recordDate: normalizePublicDividendDate(cells[indexes.recordDate]),
      paymentDate: normalizePublicDividendDate(cells[indexes.paymentDate]),
      source: 'stockanalysis',
    };
  });

  return dividends;
};

const normalizeJpmAdrDate = (value = '') => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};

const getJpmAdrStatusPriority = (status = '') => ({
  final: 4,
  amended: 3,
  initial: 2,
  tba: 1,
}[String(status || '').toLowerCase()] || 0);

export const parseJpmAdrDividends = (payload = {}) => {
  const byEvent = new Map();

  (Array.isArray(payload?.data?.items) ? payload.data.items : []).forEach((row) => {
    const recordDate = normalizeJpmAdrDate(row.recordDate);
    const paymentDate = normalizeJpmAdrDate(row.paymentDate);
    const grossRate = Number(row.ratePerDr);
    const withholdingAmount = Math.max(0, Number(row.withHoldingAmount) || 0);
    const taxReclaimFee = Math.max(0, Number(row.taxReclaimFee) || 0);
    if (!recordDate || !paymentDate || !(grossRate > 0)) return;

    const eventKey = `${recordDate}::${paymentDate}`;
    const existing = byEvent.get(eventKey);
    if (
      existing
      && getJpmAdrStatusPriority(existing.sourceStatus) >= getJpmAdrStatusPriority(row.status)
    ) return;

    const timestamp = Math.floor(new Date(`${recordDate}T00:00:00Z`).getTime() / 1000);
    byEvent.set(eventKey, {
      date: timestamp,
      amount: grossRate,
      // Korean broker receipts show the foreign withholding separately from the
      // ADR administration fee. Use the depositary's gross-minus-withholding rate;
      // do not apply the generic US 15% tax again and do not bake a receipt total in.
      netAmount: Math.max(0, grossRate - withholdingAmount - taxReclaimFee),
      recordDate,
      paymentDate,
      source: 'jpm-adr',
      sourceStatus: row.status || '',
      withholdingAmountPerShare: withholdingAmount,
      dividendFeePerShare: Math.max(0, Number(row.dividendFee) || 0),
    });
  });

  return Object.fromEntries([...byEvent.values()].map((row) => [row.date, row]));
};

const fetchJpmAdrDividends = async (input = {}, ticker = '') => {
  const currency = String(input?.originalCurrency || input?.currency || '').toUpperCase();
  const cleanTicker = normalizeTicker(ticker).replace(/\.US$/, '');
  const cusip = KNOWN_JPM_ADR_CUSIPS.get(cleanTicker);
  if (currency !== 'USD' || !cusip) return null;

  const requestKey = `jpm-adr:${cusip}`;
  let request = dividendRequests.get(requestKey);
  if (!request) {
    request = (async () => {
      const url = 'https://adr.api.wsod.com/jpmadr-public/v1/dr/dividends/'
        + `${cusip}?currentPosition=0&pageSize=100&announcementFilter=full`;
      const payload = await fetchWithSafeProxy(url);
      const dividends = parseJpmAdrDividends(payload);
      return Object.keys(dividends).length > 0 ? dividends : null;
    })().finally(() => dividendRequests.delete(requestKey));
    dividendRequests.set(requestKey, request);
  }

  return request;
};

const getStockAnalysisPathCandidates = (input = {}, ticker = '') => {
  const securityType = String(input?.securityType || '').toUpperCase();
  const name = String(input?.name || '').toUpperCase();
  const isLikelyEtf = (
    securityType.includes('ETF')
    || securityType.includes('FUND')
    || securityType.includes('TRUST')
    || KNOWN_ETF_TICKERS.has(ticker)
    || /\bETF\b/.test(name)
  );
  return isLikelyEtf ? ['etf', 'stocks'] : ['stocks', 'etf'];
};

const fetchStockAnalysisDividends = async (input, ticker) => {
  const currency = String(input?.originalCurrency || input?.currency || '').toUpperCase();
  const cleanTicker = normalizeTicker(ticker).replace(/\.US$/, '');
  if (currency !== 'USD' || !/^[A-Z0-9./-]+$/.test(cleanTicker)) return null;

  const requestKey = `stockanalysis:${cleanTicker}`;
  let request = dividendRequests.get(requestKey);
  if (!request) {
    request = (async () => {
      for (const pathType of getStockAnalysisPathCandidates(input, cleanTicker)) {
        const sourceUrl = `https://stockanalysis.com/${pathType}/${cleanTicker.toLowerCase()}/dividend/`;
        try {
          const content = await fetchTextWithSafeProxy(sourceUrl);
          if (!content) continue;
          if (!/Dividend (Information|History)/i.test(content)) continue;
          const dividends = parseStockAnalysisDividends(content);
          if (Object.keys(dividends).length > 0) return dividends;
        } catch {
          continue;
        }
      }

      return null;
    })().finally(() => dividendRequests.delete(requestKey));
    dividendRequests.set(requestKey, request);
  }

  return request;
};

export const fetchDividends = async (input) => {
  const tickers = getDividendTickers(input);
  const currency = String(input?.originalCurrency || input?.currency || '').toUpperCase();
  const kodexDividends = await fetchKodexDividends(input, tickers[0] || '');
  if (kodexDividends) return kodexDividends;
  // A failed official KODEX lookup must stay failed. Treating Yahoo's
  // payment-date-free history as success suppresses retries and hides KRW.
  if (getKnownKodexFundId(tickers[0] || '')) return null;

  const tigerDividends = await fetchTigerDividends(input, tickers[0] || '');
  if (tigerDividends) return tigerDividends;
  // Keep the last verified official history when the TIGER endpoint is down.
  // A generic quote feed cannot supply its actual payment dates.
  if (getKnownTigerKsdFund(tickers[0] || '')) return null;

  const jpmAdrDividends = await fetchJpmAdrDividends(input, tickers[0] || '');
  if (jpmAdrDividends) return jpmAdrDividends;

  const stockAnalysisDividends = await fetchStockAnalysisDividends(input, tickers[0] || '');
  if (stockAnalysisDividends) return stockAnalysisDividends;
  // Yahoo's dividend event feed does not include payment dates. Received USD
  // totals are payment-date based, so treating that incomplete feed as a
  // successful refresh would erase valid received rows whenever the primary
  // source is temporarily unavailable. Keep the previous rows and retry.
  if (requiresPaymentDateDividendSource({ currency })) return null;

  for (const yfTicker of tickers) {
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1mo&range=5y&events=div`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1mo&range=5y&events=div`,
    ];

    for (const url of urls) {
      const data = await fetchWithSafeProxy(url);
      const dividends = data?.chart?.result?.[0]?.events?.dividends;
      if (dividends && Object.keys(dividends).length > 0) return dividends;
    }
  }

  return null;
};
