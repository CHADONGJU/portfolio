export const PORTFOLIO_COLLECTION_FIELDS = [
  'assets',
  'trades',
  'memos',
  'tradeLedger',
  'autoDividends',
  'confirmedDividends',
  'dividendAssetRegistry',
  'capitalFlows',
  'portfolioSnapshots',
];

const normalizeValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeValue(value[key])]),
  );
};

export const stableSerialize = (value) => JSON.stringify(normalizeValue(value));

const normalizeCollectionRows = (rows = []) => (
  rows.map((row) => stableSerialize(row)).sort()
);

export const getComparablePortfolioState = (snapshot = {}) => ({
  portfolioName: snapshot.portfolioName || '',
  targetPortfolio: normalizeValue(snapshot.targetPortfolio || {}),
  ...Object.fromEntries(
    PORTFOLIO_COLLECTION_FIELDS.map((field) => [
      field,
      normalizeCollectionRows(Array.isArray(snapshot[field]) ? snapshot[field] : []),
    ]),
  ),
});

export const arePortfolioSnapshotsEquivalent = (left = {}, right = {}) => (
  JSON.stringify(getComparablePortfolioState(left))
  === JSON.stringify(getComparablePortfolioState(right))
);

export const arePortfolioRootFieldsEquivalent = (left = {}, right = {}) => (
  String(left.portfolioName || '') === String(right.portfolioName || '')
  && stableSerialize(left.targetPortfolio || {}) === stableSerialize(right.targetPortfolio || {})
);
