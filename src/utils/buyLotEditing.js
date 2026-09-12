// 매수 내역 편집기에서 한 건(lot)을 고칠 때의 규칙.
// 매수일을 바꾸면 그 날짜의 환율을 다시 받아와야 하므로 기존 fxRate를 지운다.
// 수량·단가만 바꾼 경우에는 이미 각인된 환율을 그대로 지킨다.
export const editBuyLot = (lot, field, value) => ({
  ...lot,
  [field]: value,
  ...(field === 'date' && value !== lot.date ? { fxRate: 0 } : {}),
});

export const resolveBuyLotFxRate = ({ lot, existingRow, currency, lookedUpRate }) => {
  if (!currency || currency === 'KRW') return 1;
  const originalDate = existingRow?.date || existingRow?.buyDate;
  const dateChanged = Boolean(originalDate) && originalDate !== lot.date;
  const stored = dateChanged ? 0 : Number(lot.fxRate) || Number(existingRow?.fxRate) || 0;
  return stored > 0 ? stored : Math.max(0, Number(lookedUpRate) || 0);
};
