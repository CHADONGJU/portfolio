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
