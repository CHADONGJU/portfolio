import assert from 'node:assert/strict';
import test from 'node:test';
import { isTargetStockAlreadyAdded, parseStockSearchResults } from '../src/services/stockSearch.js';

test('search separates Korean listings from foreign stocks and ETFs', () => {
  const quotes = [
    { symbol: '005930.KS', shortname: '삼성전자', quoteType: 'EQUITY' },
    { symbol: '247540.KQ', shortname: '에코프로비엠', quoteType: 'EQUITY' },
    { symbol: 'SPY', shortname: 'SPDR S&P 500', quoteType: 'ETF' },
    { symbol: '^GSPC', shortname: 'S&P 500', quoteType: 'INDEX' },
    { symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY' },
  ];
  const domestic = parseStockSearchResults({ quotes }, '국내주식');
  assert.deepEqual(domestic.map(({ ticker, currency }) => ({ ticker, currency })), [
    { ticker: '005930', currency: 'KRW' }, { ticker: '247540', currency: 'KRW' },
  ]);
  const overseas = parseStockSearchResults({ quotes }, '해외주식');
  assert.deepEqual(overseas.map(({ ticker, currency }) => ({ ticker, currency })), [{ ticker: 'SPY', currency: 'USD' }]);
});

test('international symbols keep their exchange and use the matching currency', () => {
  const results = parseStockSearchResults({ quotes: [
    { symbol: '7203.T', quoteType: 'EQUITY', shortname: 'Toyota' },
    { symbol: '0700.HK', quoteType: 'EQUITY', shortname: 'Tencent' },
    { symbol: 'SHEL.L', quoteType: 'EQUITY', currency: 'GBp' },
    { symbol: 'UNKNOWN.XY', quoteType: 'EQUITY' },
  ] }, '해외주식');
  assert.deepEqual(results.map(({ ticker, currency }) => ({ ticker, currency })), [
    { ticker: '7203.T', currency: 'JPY' },
    { ticker: '0700.HK', currency: 'HKD' },
    { ticker: 'SHEL.L', currency: 'GBP' },
    { ticker: 'UNKNOWN.XY', currency: '' },
  ]);
  assert.equal(results[0].nativeCurrentPrice, undefined);
});

test('empty, malformed and duplicate results do not create candidates', () => {
  for (const payload of [null, {}, { quotes: null }, { quotes: {} }]) {
    assert.deepEqual(parseStockSearchResults(payload, '해외주식'), []);
  }
  assert.deepEqual(parseStockSearchResults({ quotes: [null, {}, { symbol: {}, quoteType: 'ETF' }, { symbol: '<bad>', quoteType: 'EQUITY' }] }, '해외주식'), []);
  assert.equal(parseStockSearchResults({ quotes: [
    { symbol: 'SPY', quoteType: 'ETF' }, { symbol: 'SPY', quoteType: 'ETF' },
  ] }, '해외주식').length, 1);
});

test('duplicate detection recognizes Korean and Japanese aliases without conflating exchanges', () => {
  assert.equal(isTargetStockAlreadyAdded({ ticker: '005930.KS' }, [{ ticker: '005930' }], '국내주식'), true);
  assert.equal(isTargetStockAlreadyAdded({ ticker: '7203.T' }, [{ ticker: '7203' }], '해외주식'), true);
  assert.equal(isTargetStockAlreadyAdded({ ticker: 'SHEL.L', name: 'Shell' }, [{ ticker: 'SHEL', name: 'Shell' }], '해외주식'), false);
  assert.equal(isTargetStockAlreadyAdded({ ticker: 'AAPL', name: 'Apple' }, [{ name: 'Apple' }], '해외주식'), true);
  assert.equal(isTargetStockAlreadyAdded({}, [{}], '해외주식'), false);
});
