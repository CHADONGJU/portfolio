import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arePortfolioRootFieldsEquivalent,
  arePortfolioSnapshotsEquivalent,
} from '../src/utils/portfolioSnapshotComparison.js';

test('클라우드 컬렉션 순서만 다르면 같은 포트폴리오로 판단한다', () => {
  const left = {
    portfolioName: '주식 포트폴리오',
    targetPortfolio: { categories: [{ id: '국내주식', percent: 30 }] },
    assets: [{ id: 1, ticker: 'JEPI' }, { id: 2, ticker: 'VZ' }],
    tradeLedger: [{ id: 'a' }, { id: 'b' }],
  };
  const right = {
    portfolioName: '주식 포트폴리오',
    targetPortfolio: { categories: [{ percent: 30, id: '국내주식' }] },
    assets: [{ ticker: 'VZ', id: 2 }, { ticker: 'JEPI', id: 1 }],
    tradeLedger: [{ id: 'b' }, { id: 'a' }],
  };

  assert.equal(arePortfolioSnapshotsEquivalent(left, right), true);
});

test('수량이 달라지면 다른 포트폴리오로 판단한다', () => {
  assert.equal(arePortfolioSnapshotsEquivalent(
    { assets: [{ id: 1, ticker: 'JEPI', quantity: 145 }] },
    { assets: [{ id: 1, ticker: 'JEPI', quantity: 146 }] },
  ), false);
});

test('루트 필드 비교는 객체 키 순서 차이를 무시한다', () => {
  assert.equal(arePortfolioRootFieldsEquivalent(
    { portfolioName: 'A', targetPortfolio: { budget: 10, categories: [] } },
    { portfolioName: 'A', targetPortfolio: { categories: [], budget: 10 } },
  ), true);
});
