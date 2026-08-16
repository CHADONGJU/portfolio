import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafePortfolioWrite } from '../src/utils/portfolioWriteSafety.js';

/**
 * migratePortfolioState는 로컬 스냅샷에 없는 원격 문서를 삭제한다.
 * 루트 문서만 없고 서브컬렉션은 남아 있는 상태(첫 마이그레이션 중단)에서
 * 새 브라우저의 빈 스냅샷으로 돌면 남아 있던 기록이 전부 지워졌다.
 * 이제 원격 내용을 '이전 상태'로 넣어 같은 안전장치를 통과해야만 진행한다.
 */
test('마이그레이션이 빈 로컬 스냅샷으로 원격 기록을 지우지 못한다', () => {
  const remoteSnapshot = {
    assets: Array.from({ length: 20 }, (_, id) => ({ id })),
    tradeLedger: Array.from({ length: 140 }, (_, id) => ({ id })),
  };
  const emptyLocalSnapshot = { assets: [], tradeLedger: [] };

  assert.throws(
    () => assertSafePortfolioWrite(remoteSnapshot, emptyLocalSnapshot),
    (error) => error.code === 'unsafe-portfolio-shrink',
  );
});

test('원격이 비어 있는 정상적인 첫 마이그레이션은 막지 않는다', () => {
  const remoteSnapshot = { assets: [], tradeLedger: [] };
  const localSnapshot = {
    assets: Array.from({ length: 20 }, (_, id) => ({ id })),
    tradeLedger: Array.from({ length: 140 }, (_, id) => ({ id })),
  };

  assert.doesNotThrow(() => assertSafePortfolioWrite(remoteSnapshot, localSnapshot));
});
