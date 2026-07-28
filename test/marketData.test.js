import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areDomesticQuotesConsistent,
  isFreshQuoteTimestamp,
  pickMarketAwarePrice,
  readNaverQuote,
  selectValidatedDomesticQuote,
} from '../src/services/marketData.js';

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
