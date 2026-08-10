const toNonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const KOREAN_DIVIDEND_SMALL_WITHHOLDING_EFFECTIVE_DATE = '2024-07-01';
export const KOREAN_DIVIDEND_SMALL_WITHHOLDING_THRESHOLD = 1000;
export const KOREAN_DIVIDEND_INCOME_TAX_RATE = 0.14;

export const isKoreanDividendSmallWithholdingApplicable = ({
  currency = '',
  paymentDate = '',
  exDate = '',
} = {}) => {
  const paidDate = String(paymentDate || exDate || '').slice(0, 10);
  return String(currency || '').trim().toUpperCase() === 'KRW'
    && /^\d{4}-\d{2}-\d{2}$/.test(paidDate)
    && paidDate >= KOREAN_DIVIDEND_SMALL_WITHHOLDING_EFFECTIVE_DATE;
};

/**
 * Calculates one dividend event from source data and the eligible share count.
 * `sourceAmountIsNet` is used when the provider/broker amount must not be taxed again.
 * `skipCalculatedWithholding` skips only withholding calculated by this app. A
 * provider-supplied net amount (for example foreign withholding) remains intact.
 * Since July 2024, Korean dividend income is not withheld when the calculated
 * national income tax is below KRW 1,000. Callers opt into that rule only for
 * qualifying KRW payments so historical and foreign dividends remain unchanged.
 */
export const calculateDividendAmounts = ({
  perShareGrossAmount,
  quantity,
  withholdingRate = 0,
  taxableBasePerShare,
  perShareNetAmount,
  sourceAmountIsNet = false,
  skipCalculatedWithholding = false,
  smallWithholdingThreshold = 0,
  smallWithholdingIncomeTaxRate = 0,
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
  const threshold = toNonNegativeNumber(smallWithholdingThreshold);
  const incomeTaxRate = Math.min(1, Math.max(0, Number(smallWithholdingIncomeTaxRate) || 0));
  const incomeTaxForThreshold = taxableAmount * incomeTaxRate;
  const withholdingWaived = threshold > 0
    && incomeTaxForThreshold > 0
    && incomeTaxForThreshold < threshold;
  const taxAmount = withholdingWaived ? 0 : taxableAmount * rate;
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
    withholdingWaived,
  };
};
