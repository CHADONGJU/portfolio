import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDividendAssetRegistry,
  mergeDividendResultsByAsset,
} from '../src/utils/dividendSync.js';

const assets = [
  { id: 1, name: 'JEPI', ticker: 'JEPI' },
  { id: 2, name: '무배당', ticker: 'NONE' },
];

test('성공한 갱신 결과가 0건이면 해당 종목의 오래된 배당 행을 제거한다', () => {
  const merged = mergeDividendResultsByAsset(
    [
      { id: 'old-jepi', name: 'JEPI', date: '2025-01-01', amount: 10 },
      { id: 'old-none', name: '무배당', date: '2025-01-01', amount: 20 },
    ],
    [],
    assets,
    ['JEPI'],
  );

  assert.deepEqual(merged.map((row) => row.name), ['무배당']);
});

test('최신 무배당 결과는 과거의 배당 있음 상태와 건수를 초기화한다', () => {
  const merged = mergeDividendAssetRegistry(
    [{ name: 'JEPI', hasDividends: true, sourceDividendCount: 12, earnedDividendCount: 10 }],
    [{ name: 'JEPI', hasDividends: false, sourceDividendCount: 0, earnedDividendCount: 0, syncState: 'empty' }],
    assets,
  );

  assert.equal(merged[0].hasDividends, false);
  assert.equal(merged[0].sourceDividendCount, 0);
  assert.equal(merged[0].earnedDividendCount, 0);
  assert.equal(merged[0].syncState, 'empty');
});

test('네트워크 오류는 기존 배당 기록을 지우지 않고 오류 상태만 남긴다', () => {
  const merged = mergeDividendAssetRegistry(
    [{ name: 'JEPI', hasDividends: true, sourceDividendCount: 12, earnedDividendCount: 10, checkedAt: '2026-01-01' }],
    [{ name: 'JEPI', ticker: 'JEPI', syncState: 'error', errorMessage: 'timeout', lastErrorAt: '2026-07-17' }],
    assets,
  );

  assert.equal(merged[0].hasDividends, true);
  assert.equal(merged[0].sourceDividendCount, 12);
  assert.equal(merged[0].checkedAt, '2026-01-01');
  assert.equal(merged[0].syncState, 'error');
  assert.equal(merged[0].errorMessage, 'timeout');
});
