export const isDeletedMemoRecord = (memo = {}) => (
  memo.status === 'deleted' || Boolean(memo.deletedAt)
);

export const selectActiveMemoRecords = (memos = []) => (
  memos.filter((memo) => !isDeletedMemoRecord(memo))
);
