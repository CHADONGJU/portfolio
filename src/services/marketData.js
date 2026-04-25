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

export const fetchStockPrice = async (asset) => {
  const ticker = asset.ticker.toUpperCase().trim();

  if (asset.category === '국내주식') {
    const cleanTicker = ticker.replace(/[^0-9]/g, '');
    const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${cleanTicker}`;
    const data = await fetchWithSafeProxy(naverUrl);

    if (data?.result?.areas?.[0]?.datas?.[0]?.nv) {
      return parseFloat(data.result.areas[0].datas[0].nv);
    }
  }

  let yfTicker = ticker;
  if (asset.category === '국내주식' && !yfTicker.includes('.')) yfTicker = `${yfTicker}.KS`;

  const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${yfTicker}?interval=1m&range=1d`;
  const yfData = await fetchWithSafeProxy(yfUrl);

  return yfData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
};

export const fetchDividends = async (ticker) => {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&range=5y&events=div`;
  const data = await fetchWithSafeProxy(url);

  return data?.chart?.result?.[0]?.events?.dividends ?? null;
};
