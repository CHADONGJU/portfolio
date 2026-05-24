export const fetchUsdKrwRate = async () => {
  const primary = await fetch('https://open.er-api.com/v6/latest/USD');
  if (primary.ok) {
    const data = await primary.json();
    if (data?.rates?.KRW) return data.rates.KRW;
  }

  const fallback = await fetch(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  );
  if (fallback.ok) {
    const data = await fallback.json();
    if (data?.usd?.krw) return data.usd.krw;
  }

  return null;
};

export const fetchJpyKrwRate = async () => {
  const primary = await fetch('https://open.er-api.com/v6/latest/JPY');
  if (primary.ok) {
    const data = await primary.json();
    if (data?.rates?.KRW) return data.rates.KRW;
  }

  const fallback = await fetch(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.json',
  );
  if (fallback.ok) {
    const data = await fallback.json();
    if (data?.jpy?.krw) return data.jpy.krw;
  }

  return null;
};

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

export const fetchWithSafeProxy = async (url) => {
  const encodedUrl = encodeURIComponent(url);
  const proxies = [
    url,
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { cache: 'no-store' });
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
  const proxies = [
    url,
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { cache: 'no-store' });
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
  .replace(/\s+/g, '');

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

  const marketState = quote.marketState;
  const candidates = [];

  if (marketState?.includes('PRE')) candidates.push(quote.preMarketPrice);
  if (marketState?.includes('POST')) candidates.push(quote.postMarketPrice);
  if (marketState === 'REGULAR') candidates.push(quote.regularMarketPrice);

  candidates.push(
    quote.regularMarketPrice,
    quote.postMarketPrice,
    quote.preMarketPrice,
    quote.currentPrice,
    quote.previousClose,
  );

  const price = candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  return price === undefined ? null : Number(price);
};

const readYahooPrice = (data) => {
  const meta = data?.chart?.result?.[0]?.meta;
  const quote = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const close = quote?.close?.findLast((value) => typeof value === 'number');

  return pickMarketAwarePrice(meta)
    ?? close
    ?? meta?.chartPreviousClose
    ?? null;
};

const readYahooQuotePrice = (data) => {
  const quote = data?.quoteResponse?.result?.[0];
  return pickMarketAwarePrice(quote);
};

const isDomesticStock = (asset, ticker) => {
  return asset.category?.includes('국내') || /^\d{5,6}(\.(KS|KQ))?$/.test(ticker);
};

const isJapaneseStock = (asset, ticker) => {
  return asset.currency === 'JPY' || /^\d{4}(\.T)?$/.test(ticker);
};

const readNaverPrice = (data) => {
  const item = data?.result?.areas?.[0]?.datas?.[0];
  if (!item) return null;

  const overMarketInfo = item.nxtOverMarketPriceInfo;
  const overPrice = Number(String(overMarketInfo?.overPrice ?? '').replace(/,/g, ''));

  if (
    overMarketInfo?.overMarketStatus === 'OPEN'
    && Number.isFinite(overPrice)
    && overPrice > 0
  ) {
    return overPrice;
  }

  const currentPrice = Number(item.nv);
  return Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;
};

const toStooqSymbol = (ticker) => {
  const cleanTicker = normalizeTicker(ticker).replace(/\./g, '-').toLowerCase();
  if (cleanTicker.includes('.')) return cleanTicker;
  return `${cleanTicker}.us`;
};

const readStooqPrice = (csv) => {
  if (!csv) return null;

  const [, row] = csv.trim().split(/\r?\n/);
  if (!row) return null;

  const columns = row.split(',');
  const close = Number(columns[6]);

  return Number.isFinite(close) && close > 0 ? close : null;
};

export const fetchStockPrice = async (asset) => {
  const ticker = normalizeTicker(asset.ticker);

  if (isDomesticStock(asset, ticker)) {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
    const data = await fetchWithSafeProxy(naverUrl);

    const naverPrice = readNaverPrice(data);
    if (naverPrice !== null) return naverPrice;
  }

  const yahooTickers = isDomesticStock(asset, ticker)
    ? [ticker.includes('.') ? ticker : `${ticker}.KS`]
    : isJapaneseStock(asset, ticker)
      ? [ticker.endsWith('.T') ? ticker : `${ticker}.T`]
      : getUsTickerAliases(ticker).map((symbol) => symbol.replace(/\.US$/, ''));

  const yahooUrls = yahooTickers.flatMap((yfTicker) => [
    {
      url: `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
      reader: readYahooQuotePrice,
    },
    {
      url: `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yfTicker}`,
      reader: readYahooQuotePrice,
    },
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
  ]);

  for (const { url, reader } of yahooUrls) {
    const yfData = await fetchWithSafeProxy(url);
    const yfPrice = reader(yfData);
    if (yfPrice !== null) return yfPrice;
  }

  if (asset.currency === 'USD') {
    for (const alias of getUsTickerAliases(ticker)) {
      const stooqUrl = `https://stooq.com/q/l/?s=${toStooqSymbol(alias)}&f=sd2t2ohlcv&h&e=csv`;
      const stooqPrice = readStooqPrice(await fetchTextWithSafeProxy(stooqUrl));
      if (stooqPrice !== null) return stooqPrice;
    }
  }

  return null;
};

export const fetchDividends = async (ticker) => {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&range=5y&events=div`;
  const data = await fetchWithSafeProxy(url);

  return data?.chart?.result?.[0]?.events?.dividends ?? null;
};
