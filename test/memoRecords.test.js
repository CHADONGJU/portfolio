import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectActiveMemoRecords,
  tombstoneMemoRecords,
} from '../src/utils/memoRecords.js';
import { assertSafePortfolioWrite } from '../src/utils/portfolioWriteSafety.js';

test('clears every active memo with tombstones without removing its records', () => {
  const cleared = tombstoneMemoRecords([
    { id: 'one', memo: '첫 메모' },
    { id: 'two', memo: '둘째 메모', ledgerId: 'ledger-2' },
  ], '2026-08-13T12:00:00.000Z');

  assert.equal(cleared.length, 2);
  assert.equal(selectActiveMemoRecords(cleared).length, 0);
  assert.deepEqual(cleared[1], {
    id: 'two',
    memo: '',
    ledgerId: 'ledger-2',
    status: 'deleted',
    deletedAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
  });
});

test('keeps existing tombstones unchanged during a later clear', () => {
  const existing = { id: 'old', status: 'deleted', deletedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(tombstoneMemoRecords([existing], '2026-08-13T12:00:00.000Z')[0], existing);
});

test('passes the mass-shrink guard because memo records are preserved', () => {
  const previousMemos = Array.from({ length: 12 }, (_, index) => ({
    id: `memo-${index}`,
    ledgerId: `ledger-${index}`,
    memo: `메모 ${index}`,
  }));
  const nextMemos = tombstoneMemoRecords(previousMemos, '2026-08-13T12:00:00.000Z');

  assert.doesNotThrow(() => assertSafePortfolioWrite(
    { memos: previousMemos },
    { memos: nextMemos },
  ));
  assert.equal(nextMemos.length, previousMemos.length);
});
