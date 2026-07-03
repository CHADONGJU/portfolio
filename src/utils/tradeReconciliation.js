const EPSILON = 0.000001;

export const parseTradeNumber = (value) => {
  const parsed = parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeTradeTicker = (ticker = '') => String(ticker || '')
  .toUpperCase()
  .trim()
  .replace(/^NASDAQ:/, '')
  .replace(/^NYSE:/, '')
  .replace(/^AMEX:/, '')
  .replace(/^TYO:/, '')
  .replace(/^TSE:/, '')
  .replace(/^JP:/, '')
  .replace(/\.JP$/, '.T')
  .replace(/\.TYO$/, '.T')
  .replace(/\s+/g, '');

export const getTradeRecordSide = (record = {}) => {
  const rawSide = String(record.side || record.type || '').toLowerCase();
  if (rawSide === 'buy' || rawSide === 'sell') return rawSide;

  const action = String(record.action || '').toLowerCase();
  if (action.includes('sell') || action.includes('매도')) return 'sell';
  if (action.includes('buy') || action.includes('매수')) return 'buy';

  if (record.sellDate) return 'sell';
  if (parseTradeNumber(record.pnl ?? record.realizedPnl) !== 0) return 'sell';
  return 'buy';
};

export const getTradeRecordDate = (record = {}) => (
  record.date || record.buyDate || record.sellDate || ''
);

export const getTradeRecordPrice = (record = {}) => (
  parseTradeNumber(record.price ?? record.buyPrice ?? record.sellPrice)
);

export const getTradeAssetKey = (record = {}) => {
  const ticker = normalizeTradeTicker(record.ticker || '');
  const name = String(record.name || record.stockName || '').trim();
  const category = String(record.category || '').trim();

  if (ticker && name) return `${ticker}::${name}`;
  if (ticker) return `ticker:${ticker}`;
  return `name:${name}::${category}`;
};

const getRecordSortTime = (record = {}) => {
  const dateTime = new Date(`${getTradeRecordDate(record)}T00:00:00`).getTime();
  if (Number.isFinite(dateTime)) return dateTime;

  const createdTime = new Date(record.createdAt || 0).getTime();
  return Number.isFinite(createdTime) ? createdTime : 0;
};

export const normalizeTradeRow = (record = {}) => {
  const side = getTradeRecordSide(record);
  const date = getTradeRecordDate(record);
  const price = getTradeRecordPrice(record);
  const quantity = parseTradeNumber(record.quantity);
  const pnl = parseTradeNumber(record.pnl ?? record.realizedPnl);

  return {
    ...record,
    side,
    date,
    price,
    quantity,
    pnl,
  };
};

export const buildPositionFromTradeRows = (rows = []) => {
  let quantity = 0;
  let cost = 0;

  const normalizedRows = rows
    .map(normalizeTradeRow)
    .filter((row) => row.name && row.date && row.quantity > 0)
    .sort((a, b) => {
      const timeDelta = getRecordSortTime(a) - getRecordSortTime(b);
      if (timeDelta !== 0) return timeDelta;
      return String(a.id || a.sourceId || '').localeCompare(String(b.id || b.sourceId || ''));
    })
    .map((row) => {
      if (row.side === 'buy') {
        quantity += row.quantity;
        cost += row.quantity * row.price;
        return { ...row, pnl: 0 };
      }

      const averageCost = quantity > EPSILON ? cost / quantity : 0;
      const matchedQuantity = Math.min(row.quantity, quantity);
      const computedPnl = matchedQuantity > EPSILON
        ? (row.price - averageCost) * matchedQuantity
        : row.pnl;

      quantity = Math.max(0, quantity - matchedQuantity);
      cost = Math.max(0, cost - (averageCost * matchedQuantity));
      if (quantity <= EPSILON) {
        quantity = 0;
        cost = 0;
      }

      return {
        ...row,
        pnl: computedPnl,
        matchedQuantity,
      };
    });

  return {
    rows: normalizedRows,
    quantity,
    averagePrice: quantity > EPSILON ? cost / quantity : 0,
    firstBuyDate: normalizedRows.find((row) => row.side === 'buy')?.date || '',
    hasBuyRows: normalizedRows.some((row) => row.side === 'buy'),
  };
};

export const buildCanonicalTradeRows = ({ tradeLedger = [], trades = [] } = {}) => {
  const hasLedger = Array.isArray(tradeLedger) && tradeLedger.length > 0;
  const sourceRows = hasLedger
    ? tradeLedger
    : trades.map((trade) => ({
      ...trade,
      side: 'sell',
      date: trade.sellDate,
      price: trade.sellPrice,
    }));

  const rowsByAsset = new Map();
  sourceRows.forEach((row) => {
    const key = getTradeAssetKey(row);
    if (!rowsByAsset.has(key)) rowsByAsset.set(key, []);
    rowsByAsset.get(key).push(row);
  });

  return [...rowsByAsset.values()]
    .flatMap((rows) => buildPositionFromTradeRows(rows).rows)
    .sort((a, b) => getRecordSortTime(b) - getRecordSortTime(a));
};

export const reconcileAssetsWithTradeLedger = (assets = [], tradeLedger = []) => {
  if (!Array.isArray(tradeLedger) || tradeLedger.length === 0) return assets;

  const rowsByAsset = new Map();
  tradeLedger.forEach((row) => {
    const key = getTradeAssetKey(row);
    if (!rowsByAsset.has(key)) rowsByAsset.set(key, []);
    rowsByAsset.get(key).push(row);
  });

  let changed = false;
  const reconciled = assets
    .map((asset) => {
      const rows = rowsByAsset.get(getTradeAssetKey(asset)) || [];
      const position = buildPositionFromTradeRows(rows);
      if (!position.hasBuyRows) return asset;

      if (position.quantity <= EPSILON) {
        changed = true;
        return null;
      }

      const nextQuantity = Number(position.quantity.toFixed(8));
      const nextAveragePrice = position.averagePrice;
      const quantityChanged = Math.abs(parseTradeNumber(asset.quantity) - nextQuantity) > EPSILON;
      const averageChanged = Math.abs(parseTradeNumber(asset.originalAveragePrice || asset.averagePrice) - nextAveragePrice) > EPSILON;
      const buyDateChanged = Boolean(position.firstBuyDate && asset.buyDate !== position.firstBuyDate);

      if (!quantityChanged && !averageChanged && !buyDateChanged) return asset;

      changed = true;
      return {
        ...asset,
        quantity: nextQuantity,
        averagePrice: nextAveragePrice,
        originalAveragePrice: nextAveragePrice,
        buyDate: position.firstBuyDate || asset.buyDate,
        updatedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  return changed ? reconciled : assets;
};
