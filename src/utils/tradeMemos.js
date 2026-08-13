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
export const combineTradesWithMemos = (trades = [], memos = []) => {
  const availableMemos = new Map(memos.map((memo) => [String(memo.id), memo]));
  const directMemoByTradeIndex = new Map();

  // Reserve every stable id match before legacy heuristics run. Otherwise an
  // earlier identical row could consume a memo that explicitly belongs later.
  trades.forEach((trade, index) => {
    const directMemo = [...availableMemos.values()].find((memo) => isDirectLink(trade, memo));
    if (directMemo) {
      availableMemos.delete(String(directMemo.id));
      directMemoByTradeIndex.set(index, directMemo);
    }
  });

  const combinedRows = trades.map((trade, index) => {
    const directMemo = directMemoByTradeIndex.get(index);
    if (directMemo) return attachMemo(trade, directMemo, 'ledger-id');

    const identityMemo = [...availableMemos.values()].find((memo) => isIdentityMatch(trade, memo));
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
