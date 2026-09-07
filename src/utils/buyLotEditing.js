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
