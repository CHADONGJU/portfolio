// Portfolio input dates and reporting boundaries use the same Korean day even
// when the browser runs abroad or is opened before 09:00 KST.
export const formatKoreanDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
};

export const koreanDateStart = (dateKey) => new Date(`${dateKey}T00:00:00+09:00`);
