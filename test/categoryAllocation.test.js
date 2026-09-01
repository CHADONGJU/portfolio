import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCategoryAllocationRows,
  distributePercentTenths,
} from '../src/utils/categoryAllocation.js';

test('현재 비중은 목표 예산이 아니라 현재 자산 전체를 분모로 삼아 100%가 된다', () => {
  const rows = buildCategoryAllocationRows({
    assets: [
      { category: '국내주식', currentKRW: 158 },
      { category: '해외주식', currentKRW: 531 },
      { category: '원자재', currentKRW: 311 },
    ],
    targetCategories: [
      { id: '국내주식', percent: 30 },
      { id: '해외주식', percent: 60 },
      { id: '현금', percent: 10 },
    ],
  });

  assert.deepEqual(rows.map(({ id, currentPercent, targetPercent }) => ({ id, currentPercent, targetPercent })), [
    { id: '국내주식', currentPercent: 15.8, targetPercent: 30 },
    { id: '해외주식', currentPercent: 53.1, targetPercent: 60 },
    { id: '현금', currentPercent: 0, targetPercent: 10 },
    { id: '원자재', currentPercent: 31.1, targetPercent: 0 },
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.currentPercent, 0), 100);
});

test('각 비중을 소수점 첫째 자리로 표시해도 합계가 정확히 100.0%다', () => {
  const percents = distributePercentTenths([1, 1, 1]);

  assert.deepEqual(percents, [33.4, 33.3, 33.3]);
  assert.equal(Number(percents.reduce((sum, percent) => sum + percent, 0).toFixed(1)), 100);
});

test('보유 자산이 없으면 목표 행은 유지하되 현재 합계는 0%다', () => {
  const rows = buildCategoryAllocationRows({
    assets: [],
    targetCategories: [{ id: '국내주식', percent: 100 }],
  });

  assert.equal(rows[0].currentPercent, 0);
});
