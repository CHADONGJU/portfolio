// 삭제 표시된 메모를 걸러낸다.
// 메모는 실제로 지우지 않고 표시만 남긴다 — 기기 간 동기화에서 한쪽의 삭제가
// 다른 쪽의 수정으로 되살아나는 것을 막기 위해서다.
export const isDeletedMemoRecord = (memo = {}) => (
  memo.status === 'deleted' || Boolean(memo.deletedAt)
);

export const selectActiveMemoRecords = (memos = []) => (
  memos.filter((memo) => !isDeletedMemoRecord(memo))
);
