import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafePortfolioWrite } from '../src/utils/portfolioWriteSafety.js';

test('원장 대부분이 한 번에 사라지는 클라우드 저장을 차단한다', () => {
  assert.throws(
    () => assertSafePortfolioWrite(
      { tradeLedger: Array.from({ length: 62 }, (_, id) => ({ id })) },
      { tradeLedger: Array.from({ length: 4 }, (_, id) => ({ id })) },
    ),
    (error) => error.code === 'unsafe-portfolio-shrink'
      && error.previousCount === 62
      && error.nextCount === 4,
  );
});

test('일반적인 개별 거래 삭제는 허용한다', () => {
  assert.doesNotThrow(() => assertSafePortfolioWrite(
    { tradeLedger: Array.from({ length: 20 }, (_, id) => ({ id })) },
    { tradeLedger: Array.from({ length: 19 }, (_, id) => ({ id })) },
  ));
});

test('실제 배당 내역 전체가 빈 배열로 덮이는 저장을 차단한다', () => {
  assert.throws(
    () => assertSafePortfolioWrite(
      { confirmedDividends: Array.from({ length: 36 }, (_, id) => ({ id })) },
      { confirmedDividends: [] },
    ),
    (error) => error.code === 'unsafe-portfolio-shrink'
      && error.field === 'confirmedDividends',
  );
});

test('자동 계산 배당 대부분이 한 번에 사라지는 저장도 차단한다', () => {
  assert.throws(
    () => assertSafePortfolioWrite(
      { autoDividends: Array.from({ length: 30 }, (_, id) => ({ id })) },
      { autoDividends: Array.from({ length: 14 }, (_, id) => ({ id })) },
    ),
    (error) => error.code === 'unsafe-portfolio-shrink'
      && error.field === 'autoDividends',
  );
});

test('automatic dividend duplicate cleanup is allowed when every event remains', () => {
  const officialRows = Array.from({ length: 10 }, (_, index) => ({
    id: `official-${index}`,
    ticker: '453810',
    exDate: `202${index}-07-31`,
    paymentDate: `202${index}-08-04`,
    calculationSource: 'kodex',
  }));
  const provisionalRows = officialRows.map((row, index) => ({
    ...row,
    id: `provisional-${index}`,
    exDate: `202${index}-07-30`,
    paymentDate: `202${index}-07-30`,
    calculationSource: 'market-dividend-feed',
  }));

  assert.doesNotThrow(() => assertSafePortfolioWrite(
    { autoDividends: [...officialRows, ...provisionalRows] },
    { autoDividends: officialRows },
  ));
});
