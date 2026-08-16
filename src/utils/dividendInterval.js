/**
 * 배당 주기 추정과 월 이동을 한 곳에 모은다.
 *
 * 예전에는 App.jsx(배당 달력)와 usePortfolioMetrics.js(배당 요약)가 같은 규칙을
 * 각자 구현해두고 있었다. 한쪽만 고치면 달력의 예상일과 요약의 "N월 배당락 예상"이
 * 서로 다른 달을 가리킨다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DIVIDEND_INTERVAL_MONTHS = 3;

/** 최근 두 배당락일 간격으로 주기를 추정한다. 판단이 안 서면 분기(3개월). */
export const estimateDividendIntervalMonths = (previousDate, latestDate) => {
  const previousTime = previousDate instanceof Date ? previousDate.getTime() : NaN;
  const latestTime = latestDate instanceof Date ? latestDate.getTime() : NaN;
  if (!Number.isFinite(previousTime) || !Number.isFinite(latestTime)) {
    return DEFAULT_DIVIDEND_INTERVAL_MONTHS;
  }

  const daysDiff = Math.abs(latestTime - previousTime) / DAY_MS;
  if (daysDiff >= 20 && daysDiff <= 45) return 1;
  if (daysDiff >= 80 && daysDiff <= 110) return 3;
  if (daysDiff >= 150 && daysDiff <= 200) return 6;
  if (daysDiff >= 330) return 12;
  return DEFAULT_DIVIDEND_INTERVAL_MONTHS;
};

/**
 * 월 단위로 날짜를 옮기되 말일을 넘기지 않는다.
 * setMonth(getMonth() + 1)은 1월 31일을 3월 3일로 만들어 2월을 통째로 건너뛴다.
 */
export const addMonthsClamped = (date, months) => {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const day = date.getDate();
  const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();

  return new Date(year, month, Math.min(day, lastDayOfTargetMonth));
};
