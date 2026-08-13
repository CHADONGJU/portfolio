export const isDeletedMemoRecord = (memo = {}) => (
  memo.status === 'deleted' || Boolean(memo.deletedAt)
);

export const selectActiveMemoRecords = (memos = []) => (
  memos.filter((memo) => !isDeletedMemoRecord(memo))
);

export const tombstoneMemoRecords = (memos = [], deletedAt = new Date().toISOString()) => (
  memos.map((memo) => (
    isDeletedMemoRecord(memo)
      ? memo
      : {
        ...memo,
        memo: '',
        status: 'deleted',
        deletedAt,
        updatedAt: deletedAt,
      }
  ))
);
