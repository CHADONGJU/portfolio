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

/**
 * 배당을 받을 수 있는 마지막 매수일(거래원장 날짜 기준).
 *
 * - USD: 미국 ex-date는 현지 날짜이고 국내 원장은 한국시간 체결일로 기록되므로
 *   한 영업일 뒤로 옮겨 비교한다.
 * - KRW: 국내 ETF 피드(KODEX basicD, TIGER recordDate)는 이미 '배당기준일'을
 *   exDate 자리에 넣어준다. 기준일을 지나서 산 주식은 배당 대상이 아니므로
 *   여기에 영업일을 더하면 안 된다.
 * - 그 외 통화: 원본 날짜를 그대로 쓴다.
 */
export const getDividendEligibilityDate = (dividend = {}) => {
  const exDate = getDividendExDate(dividend);
  if (!exDate) return '';
  const currency = String(dividend.currency || '').toUpperCase();
  return currency === 'USD' ? addUtcBusinessDays(exDate, 1) : exDate;
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
