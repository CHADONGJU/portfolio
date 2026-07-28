export const fetchKrwRate = async (currency = 'USD') => {
  const baseCurrency = String(currency || 'USD').toUpperCase();
  if (baseCurrency === 'KRW') return 1;

  try {
    const primary = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
    if (primary.ok) {
      const data = await primary.json();
      if (data?.rates?.KRW) return data.rates.KRW;
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
// 모든 배치가 실제로 시도될 수 있는 예산이어야 마지막 폴백(r.jina.ai)이 사문화되지 않는다.
// 직접 호출 4초 + 프록시 배치 3개 × 7초.
const PROXY_BUDGET_MS = DIRECT_TIMEOUT_MS + (PROXY_TIMEOUT_MS * 3);

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
  // r.jina.ai로 감쌀 때도 상위 구간을 https로 유지한다(평문 다운그레이드 방지).
  const bareUrl = url.replace(/^https?:\/\//, '');
  const jinaUrl = `https://r.jina.ai/https://${bareUrl}`;

  const rest = [
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
    `https://corsproxy.io/?${encodedUrl}`,
    `https://corsproxy.io/?url=${encodedUrl}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  return jinaFirst ? [url, jinaUrl, ...rest] : [url, ...rest, jinaUrl];
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

const parseProxyJson = (text) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
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
    return text;
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
      const response = await fetch(url, { cache: 'no-store' });
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
  const meta = data?.chart?.result?.[0]?.meta;
  const quote = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const close = quote?.close?.findLast((value) => typeof value === 'number');
  const price = pickMarketAwarePrice(meta)
    ?? close
    ?? meta?.chartPreviousClose
    ?? null;

  if (price === null) return null;

  const normalized = normalizeQuote(price, meta?.currency);
  return normalized === null ? null : { ...normalized, symbol: meta?.symbol };
};

const readYahooQuotePrice = (data) => {
  const quote = data?.quoteResponse?.result?.[0];
  const price = pickMarketAwarePrice(quote);

  if (price === null) return null;

  const normalized = normalizeQuote(price, quote?.currency);
  return normalized === null ? null : { ...normalized, symbol: quote?.symbol };
};

const fetchYahooQuote = async (yfTicker) => {
  const urls = [
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
  ];

  for (const url of urls) {
    const quote = readYahooQuotePrice(await fetchWithSafeProxy(url));
    if (quote !== null) return { ...quote, source: 'yahoo' };
  }

  return null;
};

const isDomesticStock = (asset, ticker) => {
  if (isOverseasCategory(asset.category || '')) return false;
  return isDomesticCategory(asset.category || '') || /^\d{5,6}(\.(KS|KQ))?$/.test(ticker);
};

const readNaverPrice = (data) => {
  const item = data?.result?.areas?.[0]?.datas?.[0];
  if (!item) return null;

  const currentPrice = Number(item.nv);
  if (Number.isFinite(currentPrice) && currentPrice > 0) return currentPrice;

  const overMarketInfo = item.nxtOverMarketPriceInfo;
  const overPrice = Number(String(overMarketInfo?.overPrice ?? '').replace(/,/g, ''));

  if (
    overMarketInfo?.overMarketStatus === 'OPEN'
    && Number.isFinite(overPrice)
    && overPrice > 0
  ) {
    return overPrice;
  }

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
    const quote = readYahooPrice(await fetchWithSafeProxy(url));
    if (quote !== null) return { ...quote, source: 'yahoo' };
  }

  return fetchYahooQuote(yfTicker);
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

  if (isDomesticStock(asset, ticker)) {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    if (cleanTicker) {
      const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
      const data = await fetchWithSafeProxy(naverUrl);

      const naverPrice = readNaverPrice(data);
      if (naverPrice !== null) return {
        price: naverPrice,
        currency: 'KRW',
        symbol: ticker,
        source: 'naver',
      };
    }

    for (const yfTicker of getYahooTickers(asset, ticker)) {
      const yahooQuote = await fetchYahooChartQuote(yfTicker);
      if (yahooQuote !== null) return {
        ...yahooQuote,
        currency: yahooQuote.currency || 'KRW',
      };
    }

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

export const fetchDividends = async (input) => {
  for (const yfTicker of getDividendTickers(input)) {
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
