import { isSameAutomaticDividendEvent } from './dividendRecords.js';

const GUARDED_FIELDS = [
  'assets',
  'tradeLedger',
  'trades',
  'memos',
  'autoDividends',
  'confirmedDividends',
  'dividendAssetRegistry',
];
const MINIMUM_BASELINE_COUNT = 8;
const MAXIMUM_REMAINING_RATIO = 0.4;
const MAXIMUM_REMAINING_RATIO_BY_FIELD = {
  autoDividends: 0.8,
  dividendAssetRegistry: 0.7,
};

export const assertSafePortfolioWrite = (previous = null, next = {}) => {
  if (!previous) return;

  for (const field of GUARDED_FIELDS) {
    const previousRows = Array.isArray(previous[field]) ? previous[field] : [];
    const nextRows = Array.isArray(next[field]) ? next[field] : [];
    if (previousRows.length < MINIMUM_BASELINE_COUNT) continue;
    const maximumRemainingRatio = MAXIMUM_REMAINING_RATIO_BY_FIELD[field]
      || MAXIMUM_REMAINING_RATIO;
    if (nextRows.length > previousRows.length * maximumRemainingRatio) continue;
    if (
      field === 'autoDividends'
      && previousRows.every((previousRow) => nextRows.some((nextRow) => (
        isSameAutomaticDividendEvent(previousRow, nextRow)
      )))
    ) continue;

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
