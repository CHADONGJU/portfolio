export const fetchKrwRate = async (currency = 'USD') => {
  const baseCurrency = String(currency || 'USD').toUpperCase();
  if (baseCurrency === 'KRW') return 1;

  const primary = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
  if (primary.ok) {
    const data = await primary.json();
    if (data?.rates?.KRW) return data.rates.KRW;
  }

  const fallback = await fetch(
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`,
  );
  if (fallback.ok) {
    const data = await fallback.json();
    if (data?.[baseCurrency.toLowerCase()]?.krw) return data[baseCurrency.toLowerCase()].krw;
  }

  return null;
};

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

export const fetchWithSafeProxy = async (url) => {
  const encodedUrl = encodeURIComponent(url);
  const bareUrl = url.replace(/^https?:\/\//, '');
  const proxies = [
    url,
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
    `https://corsproxy.io/?${encodedUrl}`,
    `https://corsproxy.io/?url=${encodedUrl}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
    `https://r.jina.ai/http://${bareUrl}`,
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetchWithTimeout(proxy, { cache: 'no-store' });
      if (!res.ok) continue;

      const text = await res.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }

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
  const encodedUrl = encodeURIComponent(url);
  const bareUrl = url.replace(/^https?:\/\//, '');
  const jinaUrl = `https://r.jina.ai/http://${bareUrl}`;
  const proxies = [
    url,
    jinaUrl,
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
    `https://corsproxy.io/?${encodedUrl}`,
    `https://corsproxy.io/?url=${encodedUrl}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetchWithTimeout(proxy, { cache: 'no-store' });
      if (!res.ok) continue;

      const text = await res.text();

      try {
        const data = JSON.parse(text);
        if (typeof data?.contents === 'string') return data.contents;
      } catch {
        return text;
      }
    } catch {
      continue;
    }
  }

  return null;
};

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

const pickMarketAwarePrice = (quote) => {
  if (!quote) return null;

  const candidates = [];

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
  };
};

const readYahooQuotePrice = (data) => {
  const quote = data?.quoteResponse?.result?.[0];
  const price = pickMarketAwarePrice(quote);

  return price === null ? null : {
    price,
    currency: quote?.currency,
    symbol: quote?.symbol,
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
      const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
      const data = await fetchWithSafeProxy(naverUrl);

      const naverPrice = readNaverPrice(data);
      if (naverPrice !== null) return {
        price: naverPrice,
        currency: 'KRW',
        symbol: ticker,
      };
    }

    for (const yfTicker of getYahooTickers(asset, ticker)) {
      const yahooQuote = await fetchYahooChartQuote(yfTicker);
      if (yahooQuote !== null) return {
        ...yahooQuote,
        currency: yahooQuote.currency || 'KRW',
      };
    }
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
