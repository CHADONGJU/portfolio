const GUARDED_FIELDS = ['assets', 'tradeLedger', 'trades', 'memos'];
const MINIMUM_BASELINE_COUNT = 8;
const MAXIMUM_REMAINING_RATIO = 0.4;

export const assertSafePortfolioWrite = (previous = null, next = {}) => {
  if (!previous) return;

  for (const field of GUARDED_FIELDS) {
    const previousRows = Array.isArray(previous[field]) ? previous[field] : [];
    const nextRows = Array.isArray(next[field]) ? next[field] : [];
    if (previousRows.length < MINIMUM_BASELINE_COUNT) continue;
    if (nextRows.length > previousRows.length * MAXIMUM_REMAINING_RATIO) continue;

    const error = new Error(
      `${field} 데이터가 ${previousRows.length}건에서 ${nextRows.length}건으로 비정상 감소해 저장을 중단했습니다.`,
    );
    error.code = 'unsafe-portfolio-shrink';
    error.field = field;
    error.previousCount = previousRows.length;
    error.nextCount = nextRows.length;
    throw error;
  }
};
