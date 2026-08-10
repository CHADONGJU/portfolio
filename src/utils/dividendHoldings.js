const normalizeTicker = (value = '') => String(value || '').trim().toUpperCase();
const normalizeName = (value = '') => String(value || '').trim().toUpperCase();

const parseDate = (value = '') => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

export const getDividendTradeSide = (record = {}) => {
  const value = String(record.side || record.type || record.action || '').trim().toLowerCase();
  return ['sell', 'sold', '매도'].includes(value) ? 'sell' : 'buy';
};

export const isSameDividendSecurity = (record = {}, asset = {}) => {
  const assetTicker = normalizeTicker(asset.ticker);
  const recordTicker = normalizeTicker(record.ticker);
  if (assetTicker && recordTicker) return assetTicker === recordTicker;
  return Boolean(normalizeName(asset.name) && normalizeName(asset.name) === normalizeName(record.name));
};

const isLinkedLedgerRow = (record = {}) => (
  record.assetId !== undefined
  && record.assetId !== null
  && String(record.assetId).trim() !== ''
);

const isPriceClose = (left, right, tolerance = 0.05) => {
  const leftPrice = Number(left);
  const rightPrice = Number(right);
  if (!(leftPrice > 0) || !(rightPrice > 0)) return true;
  return Math.abs(leftPrice - rightPrice) / Math.max(leftPrice, rightPrice) <= tolerance;
};

const signedQuantity = (record = {}) => {
  const quantity = Number(record.quantity) || 0;
  return getDividendTradeSide(record) === 'sell' ? -quantity : quantity;
};

const isSnapshotDuplicate = (candidate = {}, linkedRows = []) => {
  if (isLinkedLedgerRow(candidate) || getDividendTradeSide(candidate) !== 'buy') return false;

  const candidateDate = parseDate(candidate.date || candidate.buyDate || candidate.sellDate);
  const candidateQuantity = Number(candidate.quantity) || 0;
  if (!(candidateQuantity > 0)) return false;

  // Recovery data may contain both an original lot and a later unlinked snapshot row.
  // If the lot itself matches, keep the dated/linked transaction and discard the snapshot.
  const matchingLot = linkedRows.some((record) => {
    if (getDividendTradeSide(record) !== 'buy') return false;
    if (Math.abs((Number(record.quantity) || 0) - candidateQuantity) > 1e-8) return false;
    if (!isPriceClose(record.price, candidate.price, 0.03)) return false;
    const recordDate = parseDate(record.date || record.buyDate || record.sellDate);
    return candidateDate > 0 && recordDate > 0
      ? Math.abs(candidateDate - recordDate) <= 45 * 24 * 60 * 60 * 1000
      : true;
  });
  if (matchingLot) return true;

  // Some snapshot rows combine several earlier lots (for example 30 + 20 shares as 50).
  const earlierRows = linkedRows.filter((record) => {
    const recordDate = parseDate(record.date || record.buyDate || record.sellDate);
    return !candidateDate || !recordDate || recordDate <= candidateDate;
  });
  const earlierQuantity = earlierRows.reduce((sum, record) => sum + signedQuantity(record), 0);
  if (Math.abs(earlierQuantity - candidateQuantity) > 1e-8) return false;

  const buys = earlierRows.filter((record) => getDividendTradeSide(record) === 'buy');
  const totalCost = buys.reduce(
    (sum, record) => sum + (Number(record.quantity) || 0) * (Number(record.price) || 0),
    0,
  );
  const totalBuyQuantity = buys.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0);
  const averagePrice = totalBuyQuantity > 0 ? totalCost / totalBuyQuantity : 0;
  return isPriceClose(averagePrice, candidate.price, 0.05);
};

/**
 * Dividend entitlement follows the security, even when a recovery changed the asset id.
 * At the same time, unlinked snapshot buys must not be added to their original lots again.
 */
export const getDividendLedgerRows = (asset = {}, ledger = []) => {
  const relatedRows = ledger.filter((record) => isSameDividendSecurity(record, asset));
  const linkedRows = relatedRows.filter(isLinkedLedgerRow);

  return relatedRows
    .filter((record) => !isSnapshotDuplicate(record, linkedRows))
    .sort((left, right) => {
      const dateDelta = parseDate(left.date || left.buyDate || left.sellDate)
        - parseDate(right.date || right.buyDate || right.sellDate);
      if (dateDelta !== 0) return dateDelta;
      return String(left.id || left.sourceId || '').localeCompare(String(right.id || right.sourceId || ''));
    });
};

export const getDividendHeldQuantityOnDate = (asset = {}, ledger = [], date = '') => {
  const targetDate = parseDate(date);
  const relatedRows = getDividendLedgerRows(asset, ledger);
  if (relatedRows.length === 0) return Number(asset.quantity) || 0;

  return Math.max(0, relatedRows.reduce((sum, record) => {
    const recordDate = parseDate(record.date || record.buyDate || record.sellDate);
    if (!recordDate || !targetDate || recordDate > targetDate) return sum;
    return sum + signedQuantity(record);
  }, 0));
};

const getSecurityKey = (record = {}) => (
  normalizeTicker(record.ticker) || normalizeName(record.name)
);

/**
 * Dividend history must also be calculated for positions that have since been
 * sold. The live asset list contains only open positions, so recreate a small
 * read-only asset descriptor from the transaction ledger for closed positions.
 */
export const buildDividendCalculationAssets = (assets = [], ledger = []) => {
  const bySecurity = new Map();

  assets.forEach((asset) => {
    const key = getSecurityKey(asset);
    if (key) bySecurity.set(key, asset);
  });

  const ledgerBySecurity = new Map();
  ledger.forEach((record) => {
    const key = getSecurityKey(record);
    if (!key) return;
    const rows = ledgerBySecurity.get(key) || [];
    rows.push(record);
    ledgerBySecurity.set(key, rows);
  });

  ledgerBySecurity.forEach((rows, key) => {
    if (bySecurity.has(key)) return;

    const sortedRows = [...rows].sort((left, right) => (
      parseDate(left.date || left.buyDate || left.sellDate)
      - parseDate(right.date || right.buyDate || right.sellDate)
    ));
    const firstBuy = sortedRows.find((row) => getDividendTradeSide(row) === 'buy');
    if (!firstBuy) return;

    const representative = sortedRows[sortedRows.length - 1] || firstBuy;
    const ticker = String(firstBuy.ticker || representative.ticker || '').trim();
    const name = String(firstBuy.name || representative.name || ticker).trim();
    const currency = String(firstBuy.currency || representative.currency || '').trim().toUpperCase()
      || (/^\d{6}$/.test(ticker) ? 'KRW' : 'USD');

    bySecurity.set(key, {
      id: `dividend-history-${ticker || key}`,
      name: name || ticker,
      ticker,
      category: firstBuy.category || representative.category || (currency === 'KRW' ? '국내주식' : '해외주식'),
      currency,
      originalCurrency: currency,
      accountType: firstBuy.accountType || representative.accountType || 'GENERAL',
      accountTypeSource: firstBuy.accountTypeSource || representative.accountTypeSource || '',
      buyDate: firstBuy.date || firstBuy.buyDate || '',
      quantity: 0,
      securityType: firstBuy.securityType || representative.securityType || '',
      historicalOnly: true,
    });
  });

  return [...bySecurity.values()];
};
