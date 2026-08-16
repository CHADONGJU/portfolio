import { normalizeAccountType } from './accountTypes.js';

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
  // 같은 종목을 여러 계좌에 나눠 담은 경우에만 계좌 범위가 붙는다.
  // 이때는 계좌가 다른 원장 행을 서로의 보유 수량으로 세면 안 된다.
  if (asset.dividendAccountScope
    && normalizeAccountType(record.accountType) !== asset.dividendAccountScope) {
    return false;
  }

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
 * 같은 원장·같은 종목이면 결과가 항상 같으므로 원장 배열 단위로 캐시한다.
 *
 * 이 함수는 원장 전체를 훑은 뒤 행마다 isSnapshotDuplicate(다시 O(관련 행 수))를
 * 돌린다. 보유 종목 수만큼 매 렌더 반복되면 원장이 커질수록 급격히 느려진다.
 * 상태를 갈아끼울 때마다 새 배열이 오므로(WeakMap 키) 오래된 결과가 남지 않는다.
 * 원장 배열을 제자리에서 변경하면 캐시가 어긋나니, 항상 새 배열로 교체해야 한다.
 */
const dividendLedgerRowsCache = new WeakMap();

const getDividendLedgerCacheKey = (asset = {}) => [
  normalizeTicker(asset.ticker),
  normalizeName(asset.name),
  asset.dividendAccountScope || '',
].join('::');

/**
 * Dividend entitlement follows the security, even when a recovery changed the asset id.
 * At the same time, unlinked snapshot buys must not be added to their original lots again.
 */
export const getDividendLedgerRows = (asset = {}, ledger = []) => {
  if (!Array.isArray(ledger) || ledger.length === 0) return [];

  let cacheByAsset = dividendLedgerRowsCache.get(ledger);
  if (!cacheByAsset) {
    cacheByAsset = new Map();
    dividendLedgerRowsCache.set(ledger, cacheByAsset);
  }

  const cacheKey = getDividendLedgerCacheKey(asset);
  const cached = cacheByAsset.get(cacheKey);
  if (cached) return cached;

  const relatedRows = ledger.filter((record) => isSameDividendSecurity(record, asset));
  const linkedRows = relatedRows.filter(isLinkedLedgerRow);

  const rows = relatedRows
    .filter((record) => !isSnapshotDuplicate(record, linkedRows))
    .sort((left, right) => {
      const dateDelta = parseDate(left.date || left.buyDate || left.sellDate)
        - parseDate(right.date || right.buyDate || right.sellDate);
      if (dateDelta !== 0) return dateDelta;
      return String(left.id || left.sourceId || '').localeCompare(String(right.id || right.sourceId || ''));
    });

  cacheByAsset.set(cacheKey, rows);
  return rows;
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
  const safeAssets = Array.isArray(assets) ? assets : [];
  const safeLedger = Array.isArray(ledger) ? ledger : [];

  /**
   * 같은 종목을 두 계좌(예: ISA + 일반)에 나눠 담으면 과세 방식이 서로 다르다.
   * 종목만으로 묶으면 한쪽 자산이 다른 쪽을 덮어써서, 살아남은 계좌의 과세 방식이
   * 합쳐진 전체 수량에 적용된다.
   *
   * 다만 모든 종목을 계좌별로 쪼개면 계좌 정보가 없는 옛 원장 행이 짝을 잃으므로,
   * 실제로 두 개 이상의 계좌에 걸쳐 있는 종목만 분리한다.
   */
  const accountsBySecurity = new Map();
  safeAssets.forEach((asset) => {
    const security = getSecurityKey(asset);
    if (!security) return;
    const accounts = accountsBySecurity.get(security) || new Set();
    accounts.add(normalizeAccountType(asset.accountType));
    accountsBySecurity.set(security, accounts);
  });

  /**
   * 계좌별로 쪼개려면 원장도 계좌별로 앞뒤가 맞아야 한다.
   *
   * 매수 행만 계좌가 다시 붙고 매도 행은 옛 계좌로 남아 있는 원장이 실제로 존재한다.
   * 그런 상태에서 계좌로 행을 걸러내면 한쪽 자산이 자기 매도 기록을 못 보고
   * 매수 수량만 세어, 배당 대상 수량이 몇 배로 부풀어 오른다.
   *
   * 그래서 "계좌별 원장 합계 == 그 계좌 자산의 보유 수량"이 모든 계좌에서 성립할 때만
   * 분리한다. 하나라도 어긋나면 예전처럼 종목 단위로 묶어 계산한다(적어도 수량은 맞다).
   */
  const isLedgerAccountConsistent = (security) => {
    const securityAssets = safeAssets.filter((asset) => getSecurityKey(asset) === security);
    const securityRows = safeLedger.filter((row) => getSecurityKey(row) === security);
    if (securityRows.length === 0) return false;

    const netByAccount = new Map();
    securityRows.forEach((row) => {
      const account = normalizeAccountType(row.accountType);
      netByAccount.set(account, (netByAccount.get(account) || 0) + signedQuantity(row));
    });

    const assetAccounts = new Set(securityAssets.map((asset) => normalizeAccountType(asset.accountType)));
    if (netByAccount.size !== assetAccounts.size) return false;

    return securityAssets.every((asset) => {
      const net = netByAccount.get(normalizeAccountType(asset.accountType));
      if (net === undefined) return false;
      return Math.abs(net - (Number(asset.quantity) || 0)) <= 1e-6;
    });
  };

  const accountSplitSecurities = new Set(
    [...accountsBySecurity.entries()]
      .filter(([security, accounts]) => accounts.size > 1 && isLedgerAccountConsistent(security))
      .map(([security]) => security),
  );

  const isAccountSplit = (record) => accountSplitSecurities.has(getSecurityKey(record));
  const getGroupKey = (record) => {
    const security = getSecurityKey(record);
    if (!security) return '';
    return isAccountSplit(record)
      ? `${security}::${normalizeAccountType(record.accountType)}`
      : security;
  };

  const bySecurity = new Map();

  safeAssets.forEach((asset) => {
    const key = getGroupKey(asset);
    if (!key) return;
    bySecurity.set(key, isAccountSplit(asset)
      ? { ...asset, dividendAccountScope: normalizeAccountType(asset.accountType) }
      : asset);
  });

  const ledgerBySecurity = new Map();
  safeLedger.forEach((record) => {
    const key = getGroupKey(record);
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

    const accountType = firstBuy.accountType || representative.accountType || 'GENERAL';

    bySecurity.set(key, {
      id: `dividend-history-${key}`,
      name: name || ticker,
      ticker,
      category: firstBuy.category || representative.category || (currency === 'KRW' ? '국내주식' : '해외주식'),
      currency,
      originalCurrency: currency,
      accountType,
      accountTypeSource: firstBuy.accountTypeSource || representative.accountTypeSource || '',
      buyDate: firstBuy.date || firstBuy.buyDate || '',
      quantity: 0,
      securityType: firstBuy.securityType || representative.securityType || '',
      historicalOnly: true,
      ...(isAccountSplit(firstBuy)
        ? { dividendAccountScope: normalizeAccountType(accountType) }
        : {}),
    });
  });

  return [...bySecurity.values()];
};
