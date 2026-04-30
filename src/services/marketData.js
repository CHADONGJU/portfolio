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

const readYahooPrice = (data) => {
  const meta = data?.chart?.result?.[0]?.meta;
  const quote = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const close = quote?.close?.findLast((value) => typeof value === 'number');

  return close
    ?? meta?.preMarketPrice
    ?? meta?.postMarketPrice
    ?? meta?.regularMarketPrice
    ?? meta?.chartPreviousClose
    ?? meta?.previousClose
    ?? null;
};

const isDomesticStock = (asset, ticker) => {
  return asset.category?.includes('국내') || /^\d{5,6}(\.(KS|KQ))?$/.test(ticker);
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
  const cleanTicker = ticker.toLowerCase().trim();
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
  const ticker = asset.ticker.toUpperCase().trim();

  if (isDomesticStock(asset, ticker)) {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
    const data = await fetchWithSafeProxy(naverUrl);

    const naverPrice = readNaverPrice(data);
    if (naverPrice !== null) return naverPrice;
  }

  let yfTicker = ticker;
  if (isDomesticStock(asset, ticker) && !yfTicker.includes('.')) yfTicker = `${yfTicker}.KS`;

  const yahooUrls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=true`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d&includePrePost=true`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1d&range=5d`,
  ];

  for (const yfUrl of yahooUrls) {
    const yfData = await fetchWithSafeProxy(yfUrl);
    const yfPrice = readYahooPrice(yfData);
    if (yfPrice !== null) return yfPrice;
  }

  if (asset.currency === 'USD') {
    const stooqUrl = `https://stooq.com/q/l/?s=${toStooqSymbol(ticker)}&f=sd2t2ohlcv&h&e=csv`;
    return readStooqPrice(await fetchTextWithSafeProxy(stooqUrl));
  }

  return null;
};

export const fetchDividends = async (ticker) => {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&range=5y&events=div`;
  const data = await fetchWithSafeProxy(url);

  return data?.chart?.result?.[0]?.events?.dividends ?? null;
};
