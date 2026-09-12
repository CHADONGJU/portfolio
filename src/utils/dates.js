// Portfolio input dates and reporting boundaries use the same Korean day even
// when the browser runs abroad or is opened before 09:00 KST.
export const formatKoreanDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
};

export const koreanDateStart = (dateKey) => new Date(`${dateKey}T00:00:00+09:00`);

/**
 * 날짜 문자열을 초 단위 숫자로. 저장된 형식이 '2026-01-05', '2026/1/5',
 * '2026. 1. 5.' 등으로 제각각이라 숫자만 뽑아 정규화한 뒤 파싱한다.
 * 읽을 수 없으면 0을 돌려 "날짜 없음"으로 취급한다.
 */
export const getDateTimestampSeconds = (date = '') => {
  const rawDate = String(date || '').trim();
  const dateParts = rawDate.match(/\d+/g);
  const normalizedDate = dateParts?.length >= 3
    ? `${dateParts[0].padStart(4, '0')}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`
    : rawDate.replace(/\s*\/\s*/g, '-').replace(/\s+/g, '');
  const timestamp = new Date(`${normalizedDate}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp / 1000 : 0;
};
