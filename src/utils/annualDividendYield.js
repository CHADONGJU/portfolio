// 예상 배당수익률.
// 한 번 받을 금액과 배당 주기(월·분기·반기·연)로 연간 예상액을 만들고,
// 현재 평가금액으로 나눈다. 어느 하나라도 모르면 0%가 아니라 null을 돌려
// "아직 계산할 수 없음"과 "수익률 0%"를 구분한다.
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
