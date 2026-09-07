import test from 'node:test';
import assert from 'node:assert/strict';
import { getPortfolioSyncError } from '../src/utils/portfolioSyncErrors.js';

test('a blocked reduction is a data protection condition, not a connection failure', () => {
  const result = getPortfolioSyncError({ code: 'unsafe-portfolio-shrink', message: 'private trade details' });
  assert.equal(result.code, 'unsafe-portfolio-shrink');
  assert.equal(result.retryable, false);
  assert.match(result.message, /기록 감소/);
  assert.doesNotMatch(result.message, /연결|private trade details/);
});

test('Firestore connection and permission failures remain distinct', () => {
  const unavailable = getPortfolioSyncError({ code: 'firestore/unavailable' });
  assert.equal(unavailable.code, 'unavailable');
  assert.equal(unavailable.retryable, true);
  assert.match(unavailable.message, /연결/);
  const permission = getPortfolioSyncError({ code: 'firestore/permission-denied' });
  assert.equal(permission.retryable, false);
  assert.match(permission.message, /권한/);
  assert.doesNotMatch(permission.message, /연결/);
});

test('expired credentials require login and are not automatically retried', () => {
  const result = getPortfolioSyncError({ code: 'auth/user-token-expired' });
  assert.equal(result.retryable, false);
  assert.match(result.message, /다시 로그인/);
});

test('server quota and browser persistence failures provide different recovery advice', () => {
  const server = getPortfolioSyncError({ code: 'resource-exhausted' });
  assert.match(server.message, /서버 사용 한도/);
  const device = getPortfolioSyncError({ name: 'QuotaExceededError' });
  assert.equal(device.code, 'local-persistence-failed');
  assert.equal(device.retryable, false);
  assert.match(device.message, /복구본/);
  assert.doesNotMatch(device.message, /보관 중|보존됩니다/);
});

test('unexpected processing errors never leak raw account or backend details', () => {
  const result = getPortfolioSyncError(new Error('private account data'));
  assert.equal(result.code, 'sync-failed');
  assert.equal(result.retryable, false);
  assert.match(result.message, /처리/);
  assert.doesNotMatch(result.message, /연결|private account data/);
  assert.equal(getPortfolioSyncError(null).code, 'sync-failed');
});
