import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecordForAsset } from '../src/utils/assetIdentity.js';

test('자산 ID가 서로 다르면 같은 티커여도 다른 포지션으로 본다', () => {
  const asset = { id: 'current-vz', name: 'VZ', ticker: 'VZ' };
  const recoveredRow = { assetId: 'recovered-vz', name: 'VZ', ticker: 'VZ' };

  assert.equal(isRecordForAsset(recoveredRow, asset), false);
});
test('레거시 원장에 자산 ID가 없으면 티커로 연결한다', () => {
  const asset = { id: 'current-vz', name: 'VZ', ticker: 'VZ' };
  const legacyRow = { name: 'VZ', ticker: 'vz' };

  assert.equal(isRecordForAsset(legacyRow, asset), true);
});
