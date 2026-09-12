// 화면 표시용 숫자·통화 포맷터와 숫자 파싱·비교 helper.
// 저장되는 값은 건드리지 않고, 사람이 읽는 문자열로만 바꾼다.
export const formatMoney = (val, currency) => {
  if (val === undefined || val === null || Number.isNaN(Number(val))) return '0';

  if (currency === 'USD') {
    return `$${Number(val).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // Math.round(-0.4)는 -0이고, (-0).toLocaleString()은 "-0"이다.
  // 0.5원짜리 손실이 화면에 "₩-0"으로 찍히지 않도록 부호 없는 0으로 눌러 준다.
  const round = (value) => Math.round(Number(value)) || 0;

  if (currency === 'JPY') {
    return `¥${round(val).toLocaleString()}`;
  }

  return `₩${round(val).toLocaleString()}`;
};

export const formatInputNumber = (value) => {
  if (value === undefined || value === null || value === '') return '';

  const numeric = String(value).replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!numeric) return '';

  const [integerPart, decimalPart] = numeric.split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};

export const sanitizeNumericInput = (value) =>
  value.replace(/,/g, '').replace(/[^\d.]/g, '');

export const getCurrencySymbol = (currency) => ({ USD: '$', JPY: '¥', KRW: '₩' }[currency] || currency);

// 화면 입력값은 "1,234.5" 같은 문자열로 들어온다. 콤마를 떼고 숫자로 읽되,
// 읽을 수 없으면 NaN 대신 0을 돌려 계산이 통째로 NaN이 되지 않게 한다.
export const parseNumber = (value) => parseFloat(String(value || '').replace(/,/g, '')) || 0;

// 부동소수점 오차를 무시하고 두 수량·금액이 같은지 본다.
// 0.1 + 0.2 !== 0.3 이라 === 로 비교하면 같은 값이 다르다고 나온다.
export const numbersMatch = (left, right) => Math.abs(parseNumber(left) - parseNumber(right)) < 0.0001;
