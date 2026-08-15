const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDateKey = (value = '') => {
  const rawValue = String(value || '').trim();
  if (DATE_KEY_PATTERN.test(rawValue)) return rawValue;

  const date = new Date(rawValue);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};

const addUtcDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const addUtcBusinessDays = (dateKey, days) => {
  let nextDate = dateKey;
  let remaining = Math.max(0, Number(days) || 0);

  while (remaining > 0) {
    nextDate = addUtcDays(nextDate, 1);
    const day = new Date(`${nextDate}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  return nextDate;
};

export const getDividendExDate = (dividend = {}) => (
  normalizeDateKey(dividend.exDate || dividend.date)
);

export const getDividendEligibilityDate = (dividend = {}) => {
  const exDate = getDividendExDate(dividend);
  if (!exDate) return '';
  const currency = String(dividend.currency || '').toUpperCase();
  return currency === 'USD' || currency === 'KRW'
    ? addUtcBusinessDays(exDate, 1)
    : exDate;
};

export const getDividendOfficialPaymentDate = (dividend = {}) => (
  normalizeDateKey(dividend.actualPaymentDate || dividend.paymentDate)
);

export const getDividendReportingDate = (dividend = {}) => {
  const actualPaymentDate = normalizeDateKey(dividend.actualPaymentDate);
  if (actualPaymentDate) return actualPaymentDate;

  const paymentDate = normalizeDateKey(dividend.paymentDate);
  if (paymentDate) {
    // 미국의 공식 지급일은 현지 날짜다. 미국 장 마감 시각은 한국에서 다음 날이므로
    // 월별 수익 화면은 한국시간 날짜로 하루 이동해 집계한다.
    const currency = String(dividend.currency || '').toUpperCase();
    return currency === 'USD' ? addUtcDays(paymentDate, 1) : paymentDate;
  }

  return getDividendExDate(dividend);
};

export const isDividendReportingDateShifted = (dividend = {}) => {
  const paymentDate = getDividendOfficialPaymentDate(dividend);
  return Boolean(paymentDate && paymentDate !== getDividendReportingDate(dividend));
};
