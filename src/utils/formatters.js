// 화면 표시용 숫자·통화 포맷터.
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
