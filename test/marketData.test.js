import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchKrwRateQuote,
  fetchUsdKrwRateQuoteByDate,
  getTradingViewSymbolCandidates,
  parseJinaJsonResponse,
  parseStockAnalysisDividends,
  readNaverQuote,
  readTradingViewQuote,
  readYahooQuotePrice,
} from '../src/services/marketData.js';

test('현재 환율은 값과 제공처와 기준 시각을 함께 반환한다', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      rates: { KRW: 1375.25 },
      time_last_update_utc: 'Sat, 18 Jul 2026 00:00:01 +0000',
    }),
  });

  try {
    const quote = await fetchKrwRateQuote('USD');
    assert.equal(quote.rate, 1375.25);
    assert.equal(quote.source, 'open.er-api.com');
    assert.equal(quote.asOf, '2026-07-18T00:00:01.000Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('해외 배당의 원화 환산은 기준일의 과거 환율을 반환한다', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ date: '2026-06-03', rates: { KRW: 1368.4 } }),
  });

  try {
    const quote = await fetchUsdKrwRateQuoteByDate('2026-06-03');
    assert.equal(quote.rate, 1368.4);
    assert.equal(quote.source, 'frankfurter.app');
    assert.equal(quote.asOf, '2026-06-03');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('과거 환율 원본이 브라우저에서 차단되면 읽기 전용 프록시로 같은 원본을 재조회한다', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith('https://api.frankfurter.app/')) {
      throw new TypeError('Failed to fetch');
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ date: '2026-06-03', rates: { KRW: 1368.4 } }),
    };
  };

  try {
    const quote = await fetchUsdKrwRateQuoteByDate('2026-06-03');
    assert.equal(quote.rate, 1368.4);
    assert.equal(quote.source, 'frankfurter.app');
    assert.equal(requestedUrls.some((url) => url.startsWith('https://r.jina.ai/http://api.frankfurter.app/')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Naver 시세는 정규장 종가보다 늦은 시간외 종가를 우선한다', () => {
  const quote = readNaverQuote({
    result: {
      areas: [{
        datas: [{
          cd: '005930',
          nv: 255000,
          nxtOverMarketPriceInfo: {
            tradingSessionType: 'AFTER_MARKET',
            overMarketStatus: 'CLOSE',
            overPrice: '253,500',
            localTradedAt: '2026-07-16T20:00:00.000000+09:00',
          },
        }],
      }],
    },
  });

  assert.equal(quote.price, 253500);
  assert.equal(quote.source, 'naver');
  assert.equal(quote.session, 'AFTER_MARKET');
});

test('Naver 정규장이 열려 있으면 이전 시간외 가격 대신 정규장 현재가를 사용한다', () => {
  const quote = readNaverQuote({
    result: {
      time: 1784250000000,
      areas: [{
        datas: [{
          cd: '005930',
          nv: 258000,
          ms: 'OPEN',
          nxtOverMarketPriceInfo: {
            tradingSessionType: 'AFTER_MARKET',
            overMarketStatus: 'CLOSE',
            overPrice: '253,500',
            localTradedAt: '2026-07-16T20:00:00.000000+09:00',
          },
        }],
      }],
    },
  });

  assert.equal(quote.price, 258000);
  assert.equal(quote.session, 'REGULAR');
  assert.equal(quote.asOf, new Date(1784250000000).toISOString());
});

test('Yahoo 시세는 정규장 이후 시간외 가격과 시각을 우선한다', () => {
  const quote = readYahooQuotePrice({
    quoteResponse: {
      result: [{
        symbol: 'JEPI',
        currency: 'USD',
        marketState: 'POST',
        regularMarketPrice: 57,
        regularMarketTime: 1784232000,
        postMarketPrice: 57.25,
        postMarketTime: 1784242800,
      }],
    },
  });

  assert.equal(quote.price, 57.25);
  assert.equal(quote.session, 'POST_MARKET');
  assert.equal(quote.asOf, new Date(1784242800 * 1000).toISOString());
});

test('TradingView 지연 시세의 가격, 통화, 지연 시간을 읽는다', () => {
  const fetchedAt = new Date('2026-07-16T18:30:00.000Z');
  const quote = readTradingViewQuote({
    s: 'AMEX:JEPI',
    d: ['JEPI', 56.875, 56.875, 'USD', 'AMEX', 'fund', 'delayed_streaming_900', null, null, null, null],
  }, fetchedAt);

  assert.equal(quote.price, 56.875);
  assert.equal(quote.currency, 'USD');
  assert.equal(quote.source, 'tradingview');
  assert.equal(quote.session, 'REGULAR_DELAYED_15_MIN');
  assert.equal(quote.asOf, null);
});

test('TradingView 시간외 현재가가 있으면 정규장 종가보다 우선한다', () => {
  const quote = readTradingViewQuote({
    s: 'AMEX:JEPI',
    d: [
      'JEPI',
      56.98,
      56.91,
      'USD',
      'AMEX',
      'fund',
      'delayed_streaming_900',
      56.5902,
      56.91,
      1784188800,
      1784232000,
    ],
  });

  assert.equal(quote.price, 56.91);
  assert.equal(quote.session, 'POST_MARKET_DELAYED_15_MIN');
  assert.equal(quote.asOf, null);
});

test('Jina가 Markdown으로 감싼 Yahoo JSON을 복원한다', () => {
  const parsed = parseJinaJsonResponse(`Title:\n\nURL Source: http://example.com\n\nMarkdown Content:\n{"chart":{"result":[{"events":{"dividends":{"1":{"date":1,"amount":35}}}}]}}`);

  assert.equal(parsed.chart.result[0].events.dividends['1'].amount, 35);
});

test('StockAnalysis 배당표에서 정확한 주당 금액과 지급일을 읽는다', () => {
  const dividends = parseStockAnalysisDividends(`
Markdown Content:
| Ex-Dividend Date | Cash Amount | Record Date | Pay Date |
| --- | --- | --- | --- |
| Jul 1, 2026 | $0.38716 | Jul 1, 2026 | Jul 6, 2026 |
| Jun 1, 2026 | $0.38921 | Jun 1, 2026 | Jun 3, 2026 |
  `);
  const latest = dividends[Math.floor(new Date('2026-07-01T00:00:00Z').getTime() / 1000)];

  assert.equal(latest.amount, 0.38716);
  assert.equal(latest.recordDate, '2026-07-01');
  assert.equal(latest.paymentDate, '2026-07-06');
});

test('해외 종목은 거래소 후보를 만들고 국내·일본 종목은 해당 시장으로 고정한다', () => {
  assert.deepEqual(
    getTradingViewSymbolCandidates({ ticker: 'JEPI', category: '해외주식', currency: 'USD' }).slice(0, 3),
    ['NASDAQ:JEPI', 'NYSE:JEPI', 'AMEX:JEPI'],
  );
  assert.deepEqual(
    getTradingViewSymbolCandidates({ ticker: '005930', category: '국내주식', currency: 'KRW' }),
    ['KRX:005930'],
  );
  assert.deepEqual(
    getTradingViewSymbolCandidates({ ticker: '7203.T', category: '해외주식', currency: 'JPY' }),
    ['TSE:7203'],
  );
});
