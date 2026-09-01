import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRootAndCollectionState } from '../src/services/portfolioStore.js';

test('스키마 2 루트가 비어 있어도 하위 컬렉션 자산과 원장을 유지한다', () => {
  const assets = Array.from({ length: 25 }, (_, id) => ({ id }));
  const tradeLedger = Array.from({ length: 62 }, (_, id) => ({ id }));
  const result = mergeRootAndCollectionState(
    {
      schemaVersion: 2,
      migrationComplete: true,
      assets: [],
      tradeLedger: [],
    },
    { assets, tradeLedger },
  );

  assert.equal(result.data.assets.length, 25);
  assert.equal(result.data.tradeLedger.length, 62);
  assert.equal(result.needsMigration, false);
});

test('하위 컬렉션이 비어 있고 레거시 루트에 데이터가 있으면 루트 데이터를 보존한다', () => {
  const result = mergeRootAndCollectionState(
    {
      schemaVersion: 2,
      migrationComplete: true,
      assets: [{ id: 'legacy' }],
    },
    { assets: [] },
  );

  assert.deepEqual(result.data.assets, [{ id: 'legacy' }]);
  assert.equal(result.needsMigration, true);
});

test('중단된 마이그레이션에서도 이미 기록된 하위 컬렉션을 읽는다', () => {
  const result = mergeRootAndCollectionState(
    {
      schemaVersion: 2,
      migrationComplete: false,
    },
    {
      assets: [{ id: 'asset' }],
      tradeLedger: [{ id: 'trade' }],
    },
  );

  assert.deepEqual(result.data.assets, [{ id: 'asset' }]);
  assert.deepEqual(result.data.tradeLedger, [{ id: 'trade' }]);
  assert.equal(result.needsMigration, true);
});
