import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMarketAwarePrice } from '../src/services/marketData.js';

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
