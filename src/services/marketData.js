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

const toFinitePrice = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
};

const parseJsonSafely = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const fetchWithSafeProxy = async (url, { responseType = 'json' } = {}) => {
  const encodedUrl = encodeURIComponent(url);
  const proxies = [
    url,
    `https://api.allorigins.win/get?url=${encodedUrl}`,
    `https://api.allorigins.win/raw?url=${encodedUrl}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
    `https://corsproxy.io/?${encodedUrl}`,
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { cache: 'no-store' });
      if (!res.ok) continue;

      const text = await res.text();
      if (responseType === 'text') {
        const wrapped = parseJsonSafely(text);
        return wrapped?.contents ?? text;
      }

      const data = parseJsonSafely(text);
      if (!data) continue;

      if (data?.contents) {
        const contents = parseJsonSafely(data.contents);
        if (contents) return contents;
        continue;
      }

      return data;
    } catch {
      continue;
    }
  }

  return null;
};

const getYahooTickerCandidates = (asset, ticker) => {
  const normalizedTicker = ticker.toUpperCase().replace(/\s+/g, '');
  let primaryTicker = normalizedTicker;
  if (asset.category === '국내주식' && !primaryTicker.includes('.')) primaryTicker = `${primaryTicker}.KS`;

  const candidates = [primaryTicker];

  if (asset.category === '해외주식' || asset.currency === 'USD') {
    if (primaryTicker.includes('.')) candidates.push(primaryTicker.replace(/\./g, '-'));
    if (primaryTicker.includes('-')) candidates.push(primaryTicker.replace(/-/g, '.'));
  }

  return [...new Set(candidates)];
};

const extractYahooPrice = (data) => {
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta ?? {};
  const metaPrices = [
    meta.regularMarketPrice,
    meta.postMarketPrice,
    meta.preMarketPrice,
    meta.previousClose,
    meta.chartPreviousClose,
  ];

  for (const price of metaPrices) {
    const parsed = toFinitePrice(price);
    if (parsed) return parsed;
  }

  const closePrices = result.indicators?.quote?.[0]?.close ?? [];
  for (let i = closePrices.length - 1; i >= 0; i -= 1) {
    const parsed = toFinitePrice(closePrices[i]);
    if (parsed) return parsed;
  }

  return null;
};

const parseStooqPrice = (csv) => {
  const lines = csv?.trim().split(/\r?\n/);
  if (!lines || lines.length < 2) return null;

  const headers = lines[0].split(',').map(header => header.trim().toLowerCase());
  const values = lines[1].split(',').map(value => value.trim());
  const closeIndex = headers.indexOf('close');
  if (closeIndex === -1 || values[closeIndex] === 'N/D') return null;

  return toFinitePrice(values[closeIndex]);
};

const getStooqTickerCandidates = (ticker) => {
  const normalizedTicker = ticker.toLowerCase().replace(/\s+/g, '');
  const baseTickers = [
    normalizedTicker,
    normalizedTicker.replace(/-/g, '.'),
    normalizedTicker.replace(/\./g, '-'),
  ];

  return [...new Set(baseTickers.map(symbol => `${symbol}.us`))];
};

const fetchYahooPrice = async (asset, ticker) => {
  const yfTickers = getYahooTickerCandidates(asset, ticker);

  for (const yfTicker of yfTickers) {
    const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=1m&range=1d`;
    const yfData = await fetchWithSafeProxy(yfUrl);
    const price = extractYahooPrice(yfData);
    if (price) return price;
  }

  return null;
};

const fetchStooqPrice = async (ticker) => {
  const stooqTickers = getStooqTickerCandidates(ticker);

  for (const stooqTicker of stooqTickers) {
    const stooqUrl = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqTicker)}&f=sd2t2ohlcv&h&e=csv`;
    const csv = await fetchWithSafeProxy(stooqUrl, { responseType: 'text' });
    const price = parseStooqPrice(csv);
    if (price) return price;
  }

  return null;
};

export const fetchStockPrice = async (asset) => {
  const ticker = asset.ticker.toUpperCase().replace(/\s+/g, '');
  if (!ticker) return null;

  if (asset.category === '국내주식') {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
    const data = await fetchWithSafeProxy(naverUrl);

    if (data?.result?.areas?.[0]?.datas?.[0]?.nv) {
      return parseFloat(data.result.areas[0].datas[0].nv);
    }
  }

  const yahooPrice = await fetchYahooPrice(asset, ticker);
  if (yahooPrice) return yahooPrice;

  if (asset.category === '해외주식' || asset.currency === 'USD') {
    return fetchStooqPrice(ticker);
  }

  return null;
};

export const fetchDividends = async (ticker) => {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&range=5y&events=div`;
  const data = await fetchWithSafeProxy(url);

  return data?.chart?.result?.[0]?.events?.dividends ?? null;
};
