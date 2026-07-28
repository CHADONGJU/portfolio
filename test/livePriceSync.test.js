import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLivePriceUpdate,
  summarizePriceSync,
} from '../src/utils/livePriceSync.js';

test('실제 시세 응답만 live로 기록하고 조회 시각과 출처를 남긴다', () => {
  const result = buildLivePriceUpdate({
    asset: {
      ticker: 'SPY',
      currency: 'USD',
      originalCurrentPrice: 700,
      currentPrice: 980000,
    },
    quote: {
      price: 710,
      currency: 'USD',
      source: 'yahoo',
      symbol: 'SPY',
    },
    rate: 1400,
    checkedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(result.status, 'live');
  assert.equal(result.asset.originalCurrentPrice, 710);
  assert.equal(result.asset.currentPrice, 994000);
  assert.equal(result.asset.quoteSource, 'yahoo');
  assert.equal(result.asset.quoteUpdatedAt, '2026-07-28T00:00:00.000Z');
});

test('시세 조회 실패 시 저장 가격을 live 성공으로 오인하지 않는다', () => {
  const result = buildLivePriceUpdate({
    asset: {
      ticker: 'SPY',
      currency: 'USD',
      originalCurrentPrice: 700,
      currentPrice: 980000,
      quoteUpdatedAt: '2026-07-27T00:00:00.000Z',
    },
    quote: null,
    rate: 1400,
    checkedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(result.status, 'cached');
  assert.equal(result.asset.quoteStatus, 'cached');
  assert.equal(result.asset.quoteUpdatedAt, '2026-07-27T00:00:00.000Z');
  assert.equal(result.asset.quoteCheckedAt, '2026-07-28T00:00:00.000Z');
});

test('해외 시세가 캐시여도 원화 평가액은 최신 환율로 다시 환산한다', () => {
  const result = buildLivePriceUpdate({
    asset: {
      ticker: 'SPY',
      currency: 'USD',
      originalCurrentPrice: 700,
      currentPrice: 945000,
    },
    quote: null,
    rate: 1400,
    checkedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(result.status, 'cached');
  assert.equal(result.asset.originalCurrentPrice, 700);
  assert.equal(result.asset.currentPrice, 980000);
});

test('비정상적인 급등락 응답은 기존 가격을 유지하고 rejected로 기록한다', () => {
  const result = buildLivePriceUpdate({
    asset: {
      ticker: '005930',
      currency: 'KRW',
      originalCurrentPrice: 70000,
      currentPrice: 70000,
    },
    quote: {
      price: 700000,
      currency: 'KRW',
      source: 'naver',
    },
    rate: 1,
    checkedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.asset.originalCurrentPrice, 70000);
  assert.equal(result.asset.quoteStatus, 'rejected');
});

test('현지 가격이 없는 해외 자산은 원화 저장값과 환산 시세를 같은 단위로 비교한다', () => {
  const result = buildLivePriceUpdate({
    asset: {
      ticker: 'SPY',
      currency: 'USD',
      currentPrice: 980000,
    },
    quote: {
      price: 710,
      currency: 'USD',
      source: 'yahoo',
    },
    rate: 1400,
    checkedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(result.status, 'live');
  assert.equal(result.asset.currentPrice, 994000);
});

test('시세 동기화 결과는 live와 캐시·실패를 분리 집계한다', () => {
  assert.deepEqual(
    summarizePriceSync(['live', 'cached', 'failed', 'rejected', 'live']),
    { live: 2, cached: 1, rejected: 1, failed: 1 },
  );
});

test('cross-provider verified quotes can repair a corrupted cached price', () => {
  const result = buildLivePriceUpdate({
    asset: {
      ticker: '000660',
      currency: 'KRW',
      originalCurrentPrice: 209500,
      currentPrice: 209500,
    },
    quote: {
      price: 1557000,
      currency: 'KRW',
      source: 'naver',
      symbol: '000660',
      providerUpdatedAt: '2026-07-28T07:12:27.301Z',
      validation: 'cross-provider',
      corroboratedBy: 'yahoo',
      verified: true,
    },
    rate: 1,
    checkedAt: '2026-07-28T08:00:00.000Z',
  });

  assert.equal(result.status, 'live');
  assert.equal(result.asset.currentPrice, 1557000);
  assert.equal(result.asset.originalCurrentPrice, 1557000);
  assert.equal(result.asset.quoteProviderUpdatedAt, '2026-07-28T07:12:27.301Z');
  assert.equal(result.asset.quoteValidation, 'cross-provider');
  assert.equal(result.asset.quoteCorroboratedBy, 'yahoo');
});
