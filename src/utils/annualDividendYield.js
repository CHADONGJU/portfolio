export const calculateAnnualDividendYield = ({
  expectedPaymentAmount = 0,
  intervalMonths = 0,
  currentValue = 0,
} = {}) => {
  const paymentAmount = Number(expectedPaymentAmount) || 0;
  const interval = Number(intervalMonths) || 0;
  const value = Number(currentValue) || 0;

  if (paymentAmount <= 0 || interval <= 0 || value <= 0) {
    return {
      expectedAnnualAmount: 0,
      annualDividendYieldPercent: null,
    };
  }

  const expectedAnnualAmount = paymentAmount * (12 / interval);
  return {
    expectedAnnualAmount,
    annualDividendYieldPercent: (expectedAnnualAmount / value) * 100,
  };
};
