import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areDomesticQuotesConsistent,
  getKnownKodexFundId,
  getKnownTigerKsdFund,
  getTradingViewSymbolCandidates,
  isFreshQuoteTimestamp,
  parseJpmAdrDividends,
  parseKodexDividends,
  parseProxyJson,
  parseStockAnalysisDividends,
  parseTigerDividends,
  pickMarketAwarePrice,
  readNaverQuote,
  readTradingViewQuote,
  requiresPaymentDateDividendSource,
  selectValidatedDomesticQuote,
} from '../src/services/marketData.js';

test('uses stable official KODEX product ids for the two India ETFs', () => {
  assert.equal(getKnownKodexFundId('453810.KS'), '2ETFJ1');
  assert.equal(getKnownKodexFundId('477730'), '2ETFM6');
  assert.equal(getKnownKodexFundId('277630'), '');
});

test('uses the official TIGER fund code for TIGER 코스피', () => {
  assert.equal(getKnownTigerKsdFund('277630.KS'), 'KR7277630000');
  assert.equal(getKnownTigerKsdFund('453810'), '');
});

test('does not replace received USD history with a source that lacks payment dates', () => {
  assert.equal(requiresPaymentDateDividendSource({ currency: 'USD' }), true);
  assert.equal(requiresPaymentDateDividendSource({ originalCurrency: 'usd' }), true);
  assert.equal(requiresPaymentDateDividendSource({ currency: 'KRW' }), false);
});

test('장후 거래 중에는 전일 종가보다 장후 가격을 우선한다', () => {
  assert.equal(pickMarketAwarePrice({
    marketState: 'POST',
    regularMarketPrice: 100,
    previousClose: 98,
    postMarketPrice: 102,
  }), 102);
});

test('장전 거래 중에는 전일 종가보다 장전 가격을 우선한다', () => {
  assert.equal(pickMarketAwarePrice({
    marketState: 'PRE',
    regularMarketPrice: 100,
    previousClose: 98,
    preMarketPrice: 101,
  }), 101);
});

test('정규장에는 정규장 가격을 우선한다', () => {
  assert.equal(pickMarketAwarePrice({
    marketState: 'REGULAR',
    regularMarketPrice: 103,
    previousClose: 98,
    postMarketPrice: 104,
  }), 103);
});

test('uses the open Naver after-market price and keeps the provider timestamp', () => {
  const quote = readNaverQuote({
    result: {
      time: 1785222747301,
      areas: [{
        datas: [{
          nv: 1550000,
          nxtOverMarketPriceInfo: {
            overMarketStatus: 'OPEN',
            overPrice: '1,557,000',
            localTradedAt: '2026-07-28T16:12:27.301676+09:00',
            tradingSessionType: 'AFTER_MARKET',
          },
        }],
      }],
    },
  });

  assert.equal(quote.price, 1557000);
  assert.equal(quote.providerUpdatedAt, '2026-07-28T07:12:27.301Z');
  assert.equal(quote.marketSession, 'AFTER_MARKET');
});

test('rejects stale provider timestamps even when a price is present', () => {
  const now = Date.parse('2026-07-28T08:00:00.000Z');

  assert.equal(isFreshQuoteTimestamp('2026-07-28T07:00:00.000Z', now), true);
  assert.equal(isFreshQuoteTimestamp('2026-07-01T07:00:00.000Z', now), false);
});

test('accepts matching fresh Naver and Yahoo quotes as cross-provider verified', () => {
  const now = Date.parse('2026-07-28T08:00:00.000Z');
  const naver = {
    price: 1557000,
    currency: 'KRW',
    source: 'naver',
    providerUpdatedAt: '2026-07-28T07:12:27.301Z',
  };
  const yahoo = {
    price: 1550000,
    currency: 'KRW',
    source: 'yahoo',
    providerUpdatedAt: '2026-07-28T07:10:12.000Z',
  };
  const quote = selectValidatedDomesticQuote(naver, yahoo, now);

  assert.equal(areDomesticQuotesConsistent(naver, yahoo), true);
  assert.equal(quote.price, 1557000);
  assert.equal(quote.verified, true);
  assert.equal(quote.validation, 'cross-provider');
  assert.equal(quote.corroboratedBy, 'yahoo');
});

test('ignores a stale cached Naver quote and selects the fresh Yahoo quote', () => {
  const now = Date.parse('2026-07-28T08:00:00.000Z');
  const quote = selectValidatedDomesticQuote({
    price: 209500,
    source: 'naver',
    providerUpdatedAt: '2025-07-24T00:00:00.000Z',
  }, {
    price: 1550000,
    source: 'yahoo',
    providerUpdatedAt: '2026-07-28T07:10:12.000Z',
  }, now);

  assert.equal(quote.price, 1550000);
  assert.equal(quote.source, 'yahoo');
  assert.equal(quote.validation, 'fresh-provider-timestamp');
});

test('rejects fresh domestic quotes when providers materially disagree', () => {
  const now = Date.parse('2026-07-28T08:00:00.000Z');
  const quote = selectValidatedDomesticQuote({
    price: 209500,
    source: 'naver',
    providerUpdatedAt: '2026-07-28T07:12:27.301Z',
  }, {
    price: 1550000,
    source: 'yahoo',
    providerUpdatedAt: '2026-07-28T07:10:12.000Z',
  }, now);

  assert.equal(quote, null);
});

test('builds direct TradingView candidates for Korean and US listings', () => {
  assert.deepEqual(getTradingViewSymbolCandidates({
    ticker: '000660',
    category: '국내주식',
    currency: 'KRW',
  }), ['KRX:000660']);
  assert.ok(getTradingViewSymbolCandidates({
    ticker: 'VZ',
    category: '해외주식',
    currency: 'USD',
  }).includes('NYSE:VZ'));
});

test('reads TradingView delayed quotes as usable direct market data', () => {
  const quote = readTradingViewQuote({
    s: 'NYSE:VZ',
    d: ['VZ', 47.36, 47.4, 'USD', 'NYSE', 'stock', 'delayed_streaming_900', null, 47.4, null, 123],
  });

  assert.equal(quote.price, 47.4);
  assert.equal(quote.currency, 'USD');
  assert.equal(quote.source, 'tradingview');
  assert.equal(quote.marketSession, 'POST_MARKET_DELAYED_15_MIN');
});

test('parses JSON wrapped by the Jina markdown response', () => {
  const parsed = parseProxyJson('Title:\n\nMarkdown Content:\n{"chart":{"result":[]}}');
  assert.deepEqual(parsed, { chart: { result: [] } });
});

test('keeps ex, record, and payment dates from StockAnalysis dividend rows', () => {
  const dividends = parseStockAnalysisDividends(`
| Ex-Dividend Date | Cash Amount | Record Date | Pay Date |
| --- | --- | --- | --- |
| Jul 10, 2026 | $0.7075 | Jul 10, 2026 | Aug 3, 2026 |
  `);
  const row = Object.values(dividends)[0];

  assert.equal(row.amount, 0.7075);
  assert.equal(row.recordDate, '2026-07-10');
  assert.equal(row.paymentDate, '2026-08-03');
});

test('finds PG pay date by header instead of mistaking declaration date for payment', () => {
  const dividends = parseStockAnalysisDividends(`
| Ex-Dividend Date | Cash Amount | Declaration Date | Record Date | Pay Date |
| --- | --- | --- | --- | --- |
| Jul 24, 2026 | $1.089 | Jul 14, 2026 | Jul 24, 2026 | Aug 17, 2026 |
  `);
  const row = Object.values(dividends)[0];

  assert.equal(row.recordDate, '2026-07-24');
  assert.equal(row.paymentDate, '2026-08-17');
});

test('uses JPM ADR gross minus foreign withholding for NVO without double tax', () => {
  const dividends = parseJpmAdrDividends({
    data: {
      items: [
        {
          recordDate: '2026-03-30T00:00:00.000Z',
          paymentDate: '2026-04-08T00:00:00.000Z',
          ratePerDr: 1.217376,
          withHoldingAmount: 0.328691,
          dividendFee: 0.015,
          status: 'Final',
        },
        {
          recordDate: '2026-03-30T00:00:00.000Z',
          paymentDate: '2026-04-08T00:00:00.000Z',
          ratePerDr: 1.275101,
          withHoldingAmount: 0.344277,
          dividendFee: 0.015,
          status: 'Initial',
        },
      ],
    },
  });
  const row = Object.values(dividends)[0];

  assert.equal(row.amount, 1.217376);
  assert.ok(Math.abs(row.netAmount - 0.888685) < 0.0000001);
  assert.equal(row.paymentDate, '2026-04-08');
  assert.equal(row.source, 'jpm-adr');
});

test('parses official KODEX gross distributions and taxable bases', () => {
  const dividends = parseKodexDividends({
    dividList: [{
      basicD: '20260731',
      dividA: '76',
      payD: '20260804',
      taxDividA: '76',
    }],
  });
  const row = Object.values(dividends)[0];

  assert.equal(row.amount, 76);
  assert.equal(row.paymentDate, '2026-08-04');
  assert.equal(row.taxableBasePerShare, 76);
  assert.equal(row.sourceAmountIsNet, false);
  assert.equal(row.source, 'kodex');
});

test('parses official TIGER distribution payment dates and taxable amounts', () => {
  const dividends = parseTigerDividends(`
    <table><tbody><tr>
      <td>2026-07-31</td><td>2026-08-04</td><td>60</td><td>60</td>
    </tr></tbody></table>
  `);
  const row = Object.values(dividends)[0];

  assert.equal(row.recordDate, '2026-07-31');
  assert.equal(row.paymentDate, '2026-08-04');
  assert.equal(row.amount, 60);
  assert.equal(row.taxableBasePerShare, 60);
  assert.equal(row.sourceAmountIsNet, false);
  assert.equal(row.source, 'tiger');
});
