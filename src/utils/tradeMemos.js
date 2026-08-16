const toNumber = (value) => Number(String(value ?? '').replace(/,/g, '')) || 0;
const numbersMatch = (left, right) => Math.abs(toNumber(left) - toNumber(right)) < 0.0001;

const getTradeSide = (record = {}) => {
  if (record.side === 'buy' || record.type === 'buy' || record.action === '매수') return 'buy';
  if (record.side === 'sell' || record.type === 'sell' || record.action === '매도') return 'sell';
  if (record.sellDate || Number(record.pnl || record.realizedPnl || 0) !== 0) return 'sell';
  return 'buy';
};

const getTradeDate = (record = {}) => record.date || record.sellDate || record.buyDate || '';
const getTradePrice = (record = {}) => (
  record.price || (getTradeSide(record) === 'sell' ? record.sellPrice : record.buyPrice) || 0
);

const isIdentityMatch = (trade = {}, memo = {}) => {
  if (!trade.name || trade.name !== memo.name) return false;
  if (!getTradeDate(trade) || getTradeDate(trade) !== getTradeDate(memo)) return false;
  if (getTradeSide(trade) !== getTradeSide(memo)) return false;
  if (toNumber(trade.quantity) && toNumber(memo.quantity) && !numbersMatch(trade.quantity, memo.quantity)) return false;
  if (toNumber(getTradePrice(trade)) && toNumber(getTradePrice(memo)) && !numbersMatch(getTradePrice(trade), getTradePrice(memo))) return false;
  return true;
};

const isDirectLink = (trade = {}, memo = {}) => {
  const tradeId = String(trade.id ?? '');
  const sourceId = String(trade.sourceId ?? '');
  const memoLedgerId = String(memo.ledgerId ?? '');
  const memoSourceId = `memo-${String(memo.id ?? '')}`;

  return Boolean(
    (memoLedgerId && (memoLedgerId === tradeId || memoLedgerId === sourceId))
    || (sourceId && sourceId === memoSourceId)
    || (tradeId && tradeId === memoSourceId)
  );
};

const attachMemo = (trade, memo, memoLinkType) => ({
  ...trade,
  memo: memo?.memo || '',
  memoRecordId: memo?.id ?? null,
  memoLedgerId: memo?.ledgerId || '',
  memoLinkType,
});

/**
 * A memo can be attached to at most one ledger row. Stable ledger ids win; old
 * records fall back to their transaction fields. Any unmatched memo is returned
 * as a visible recovery row instead of being dropped from the UI.
 */
const getMemoIdentityBucketKey = (record = {}) => [
  record.name || '',
  getTradeDate(record),
  getTradeSide(record),
].join('::');

/**
 * 거래마다 메모 배열 전체를 새로 만들어 훑으면 O(거래 × 메모)가 된다.
 * 메모가 수백 건이면 필터 입력 한 글자마다 수십만 번 비교가 돌았다.
 * 매칭에 반드시 필요한 조건(연결 id / 이름·날짜·매매구분)으로 미리 색인해두고,
 * 그 작은 후보 묶음 안에서만 원래 순서대로 검사한다. 결과는 이전과 같다.
 */
const buildMemoIndexes = (memos = []) => {
  const byLinkKey = new Map();
  const byIdentityKey = new Map();

  const push = (index, key, memo) => {
    if (!key) return;
    const bucket = index.get(key);
    if (bucket) bucket.push(memo);
    else index.set(key, [memo]);
  };

  memos.forEach((memo) => {
    const memoId = String(memo.id ?? '');
    push(byLinkKey, String(memo.ledgerId ?? ''), memo);
    if (memoId) push(byLinkKey, `memo-${memoId}`, memo);
    push(byIdentityKey, getMemoIdentityBucketKey(memo), memo);
  });

  return { byLinkKey, byIdentityKey };
};

export const combineTradesWithMemos = (trades = [], memos = []) => {
  const availableMemos = new Map(memos.map((memo) => [String(memo.id), memo]));
  const directMemoByTradeIndex = new Map();
  const { byLinkKey, byIdentityKey } = buildMemoIndexes(memos);

  const findAvailable = (candidates, matches) => (
    candidates.find((memo) => availableMemos.has(String(memo.id)) && matches(memo)) || null
  );

  // Reserve every stable id match before legacy heuristics run. Otherwise an
  // earlier identical row could consume a memo that explicitly belongs later.
  trades.forEach((trade, index) => {
    const candidates = [
      ...(byLinkKey.get(String(trade.id ?? '')) || []),
      ...(byLinkKey.get(String(trade.sourceId ?? '')) || []),
    ];
    const directMemo = findAvailable(candidates, (memo) => isDirectLink(trade, memo));
    if (directMemo) {
      availableMemos.delete(String(directMemo.id));
      directMemoByTradeIndex.set(index, directMemo);
    }
  });

  const combinedRows = trades.map((trade, index) => {
    const directMemo = directMemoByTradeIndex.get(index);
    if (directMemo) return attachMemo(trade, directMemo, 'ledger-id');

    const candidates = byIdentityKey.get(getMemoIdentityBucketKey(trade)) || [];
    const identityMemo = findAvailable(candidates, (memo) => isIdentityMatch(trade, memo));
    if (identityMemo) {
      availableMemos.delete(String(identityMemo.id));
      return attachMemo(trade, identityMemo, 'legacy-identity');
    }

    return attachMemo(trade, null, 'none');
  });

  const recoveryRows = [...availableMemos.values()].map((memo) => ({
    ...memo,
    id: `unlinked-memo-${memo.id}`,
    originalMemoId: memo.id,
    sourceType: 'memo-recovery',
    memoRecordId: memo.id,
    memoLedgerId: memo.ledgerId || '',
    memoLinkType: 'unlinked',
    isUnlinkedMemo: true,
  }));

  return [...combinedRows, ...recoveryRows];
};
