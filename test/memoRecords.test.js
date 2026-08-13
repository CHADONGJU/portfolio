import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDeletedMemoRecord,
  selectActiveMemoRecords,
} from '../src/utils/memoRecords.js';

test('filters deleted memo records from the visible memo list', () => {
  const active = { id: 'active', memo: '유지할 메모' };
  const deletedByStatus = { id: 'status', memo: '', status: 'deleted' };
  const deletedByTimestamp = { id: 'timestamp', memo: '', deletedAt: '2026-08-13T12:00:00.000Z' };

  assert.deepEqual(
    selectActiveMemoRecords([active, deletedByStatus, deletedByTimestamp]),
    [active],
  );
});

test('recognizes both supported deleted memo markers', () => {
  assert.equal(isDeletedMemoRecord({ status: 'deleted' }), true);
  assert.equal(isDeletedMemoRecord({ deletedAt: '2026-08-13T12:00:00.000Z' }), true);
  assert.equal(isDeletedMemoRecord({ memo: '활성 메모' }), false);
});
