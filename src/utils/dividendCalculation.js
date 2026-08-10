const toNonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * Calculates one dividend event from source data and the eligible share count.
 * `sourceAmountIsNet` is used when the provider/broker amount must not be taxed again.
 * `skipCalculatedWithholding` skips only withholding calculated by this app. A
 * provider-supplied net amount (for example foreign withholding) remains intact.
 */
export const calculateDividendAmounts = ({
  perShareGrossAmount,
  quantity,
  withholdingRate = 0,
  taxableBasePerShare,
  perShareNetAmount,
  sourceAmountIsNet = false,
  skipCalculatedWithholding = false,
} = {}) => {
  const grossPerShare = toNonNegativeNumber(perShareGrossAmount);
  const heldQuantity = toNonNegativeNumber(quantity);
  const grossAmount = grossPerShare * heldQuantity;

  const suppliedNetPerShare = Number(perShareNetAmount);
  if (Number.isFinite(suppliedNetPerShare) && suppliedNetPerShare >= 0) {
    const netAmount = suppliedNetPerShare * heldQuantity;
    return {
      quantity: heldQuantity,
      perShareGrossAmount: grossPerShare,
      perShareNetAmount: suppliedNetPerShare,
      grossAmount,
      taxableAmount: Math.max(0, grossAmount - netAmount),
      taxAmount: Math.max(0, grossAmount - netAmount),
      amount: netAmount,
      effectiveTaxRate: grossAmount > 0 ? Math.max(0, grossAmount - netAmount) / grossAmount : 0,
    };
  }

  if (sourceAmountIsNet || skipCalculatedWithholding) {
    return {
      quantity: heldQuantity,
      perShareGrossAmount: grossPerShare,
      perShareNetAmount: grossPerShare,
      grossAmount,
      taxableAmount: 0,
      taxAmount: 0,
      amount: grossAmount,
      effectiveTaxRate: 0,
    };
  }

  const rate = Math.min(1, Math.max(0, Number(withholdingRate) || 0));
  const suppliedTaxableBase = Number(taxableBasePerShare);
  const taxablePerShare = Number.isFinite(suppliedTaxableBase)
    ? Math.min(grossPerShare, Math.max(0, suppliedTaxableBase))
    : grossPerShare;
  const taxableAmount = taxablePerShare * heldQuantity;
  const taxAmount = taxableAmount * rate;
  const amount = Math.max(0, grossAmount - taxAmount);

  return {
    quantity: heldQuantity,
    perShareGrossAmount: grossPerShare,
    perShareNetAmount: heldQuantity > 0 ? amount / heldQuantity : 0,
    grossAmount,
    taxableAmount,
    taxAmount,
    amount,
    effectiveTaxRate: grossAmount > 0 ? taxAmount / grossAmount : 0,
  };
};
