import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioBackup, parsePortfolioBackup } from '../src/utils/portfolioBackup.js';

test('포트폴리오 전체 상태를 버전이 있는 JSON 백업으로 왕복한다', () => {
  const snapshot = {
    portfolioName: '테스트',
    assets: [{ id: 1, ticker: '005930' }],
    tradeLedger: [{ id: 'lot-1', quantity: 5 }],
  };
  const backup = createPortfolioBackup(snapshot);
  const parsed = parsePortfolioBackup(JSON.stringify(backup));

  assert.equal(parsed.kind, 'my-portfolio-backup');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.data, snapshot);
});

test('배열 필드가 훼손된 백업은 복원을 거부한다', () => {
  assert.throws(() => parsePortfolioBackup(JSON.stringify({
    kind: 'my-portfolio-backup',
    version: 1,
    data: { assets: 'broken' },
  })), /assets/);
});
