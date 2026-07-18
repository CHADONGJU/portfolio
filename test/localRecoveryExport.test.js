import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyLocalSnapshot, summarizeLocalSnapshot } from '../src/utils/localRecoveryExport.js';

const createStorage = (values = {}) => ({
  getItem: (key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null,
});

test('읽기 전용 복구는 네임스페이스가 아닌 이전 원본 키만 수집한다', () => {
  const storage = createStorage({
    portfolio_assets_v17: JSON.stringify([{ id: 1, ticker: '453810' }]),
    portfolio_trade_ledger_v1: JSON.stringify([{ id: 'buy-1', updatedAt: '2026-07-01T00:00:00.000Z' }]),
    'my-portfolio:portfolio_assets_v17': JSON.stringify([]),
  });

  const snapshot = buildLegacyLocalSnapshot(storage);
  const summary = summarizeLocalSnapshot(snapshot);

  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.tradeLedger.length, 1);
  assert.equal(summary.latestUpdatedAt, '2026-07-01T00:00:00.000Z');
});
