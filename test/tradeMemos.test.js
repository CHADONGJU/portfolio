import assert from 'node:assert/strict';
import test from 'node:test';

import { combineTradesWithMemos } from '../src/utils/tradeMemos.js';

test('prefers a stable ledger id when otherwise identical trades exist', () => {
  const rows = combineTradesWithMemos([
    { id: 'ledger-1', name: 'QCOM', side: 'buy', date: '2026-01-02', quantity: 2, price: 100 },
    { id: 'ledger-2', name: 'QCOM', side: 'buy', date: '2026-01-02', quantity: 2, price: 100 },
  ], [
    { id: 'memo-2', ledgerId: 'ledger-2', name: 'QCOM', side: 'buy', date: '2026-01-02', quantity: 2, price: 100, memo: '두 번째 거래' },
  ]);

  assert.equal(rows[0].memo, '');
  assert.equal(rows[1].memo, '두 번째 거래');
  assert.equal(rows[1].memoLinkType, 'ledger-id');
});

test('legacy matching never reuses one memo for multiple trades', () => {
  const rows = combineTradesWithMemos([
    { id: 'ledger-1', name: 'QCOM', side: 'buy', date: '2026-01-02', quantity: 2, price: 100 },
    { id: 'ledger-2', name: 'QCOM', side: 'buy', date: '2026-01-02', quantity: 2, price: 100 },
  ], [
    { id: 'old-memo', name: 'QCOM', side: 'buy', date: '2026-01-02', quantity: 2, price: 100, memo: '과거 메모' },
  ]);

  assert.equal(rows.filter((row) => row.memo === '과거 메모').length, 1);
});

test('keeps an unmatched historical memo as a visible recovery row', () => {
  const rows = combineTradesWithMemos([], [
    { id: 'orphan', name: '과거 종목', side: 'sell', date: '2024-02-01', memo: '삭제하면 안 됨' },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].isUnlinkedMemo, true);
  assert.equal(rows[0].memoRecordId, 'orphan');
  assert.equal(rows[0].memo, '삭제하면 안 됨');
});
