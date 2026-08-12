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

/**
 * 보유 회차(round).
 * 같은 종목이라도 "전량 매도 후 다시 매수"하면 새 회차가 부여된다.
 * 회차가 다르면 평단가·실현손익을 절대 섞지 않는다.
 * 회차 정보가 없는 과거 데이터는 모두 1차로 본다.
 */
export const getTradeRound = (record = {}) => {
  const round = Number(record?.round ?? record?.positionRound);
  return Number.isFinite(round) && round >= 1 ? Math.floor(round) : 1;
};

/** 회차를 뺀 "종목 자체"의 키. 새 회차 번호를 매길 때 같은 종목인지 판단하는 기준이다. */
export const getTradeAssetBaseKey = (record = {}) => {
  const ticker = normalizeTradeTicker(record.ticker || '');
  const name = String(record.name || record.stockName || '').trim();
  const category = String(record.category || '').trim();

  if (ticker && name) return `${ticker}::${name}`;
  if (ticker) return `ticker:${ticker}`;
  return `name:${name}::${category}`;
};

export const getTradeAssetKey = (record = {}) => (
  `${getTradeAssetBaseKey(record)}#${getTradeRound(record)}`
);

/**
 * 같은 종목의 기존 기록들을 보고 "이번 매수가 몇 차인지" 정한다.
 * - 아직 보유 중인 회차가 있으면 그 회차에 합산(= 추가 매수)한다.
 * - 전량 매도되어 보유 수량이 0이면 마지막 회차 + 1로 새 회차를 연다.
 */
export const resolveNextTradeRound = ({ record = {}, assets = [], tradeLedger = [] } = {}) => {
  const baseKey = getTradeAssetBaseKey(record);

  const heldRounds = assets
    .filter((asset) => getTradeAssetBaseKey(asset) === baseKey && parseTradeNumber(asset.quantity) > EPSILON)
    .map(getTradeRound);
  if (heldRounds.length > 0) return Math.max(...heldRounds);

  const ledgerRounds = tradeLedger
    .filter((entry) => getTradeAssetBaseKey(entry) === baseKey)
    .map(getTradeRound);
  const knownRounds = [
    ...ledgerRounds,
    ...assets.filter((asset) => getTradeAssetBaseKey(asset) === baseKey).map(getTradeRound),
  ];
  if (knownRounds.length === 0) return 1;

  return Math.max(...knownRounds) + 1;
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
  const recordedPnl = record.pnl ?? record.realizedPnl;
  const hasRecordedPnl = recordedPnl !== null
    && recordedPnl !== undefined
    && recordedPnl !== '';
  const pnl = parseTradeNumber(record.pnl ?? record.realizedPnl);
  const brokerFee = parseTradeNumber(record.brokerFee ?? record.fee ?? record.commission);
  const sellTax = parseTradeNumber(record.sellTax ?? record.tax ?? record.transactionTax);
  const grossPnl = parseTradeNumber(record.grossPnl);

  return {
    ...record,
    side,
    date,
    price,
    quantity,
    pnl,
    grossPnl,
    brokerFee,
    sellTax,
    brokerFeeRate: parseTradeNumber(record.brokerFeeRate),
    brokerFeeRatePercent: parseTradeNumber(record.brokerFeeRatePercent),
    sellTaxRatePercent: parseTradeNumber(record.sellTaxRatePercent),
    hasRecordedPnl,
  };
};

/**
 * 매수 시점 환율로 "실제로 낸 원화"를 함께 따라간다.
 *
 * 증권사(토스 등)가 보여주는 투자 원금은 매수 당시 환율로 낸 원화이지 오늘 환율로
 * 다시 환산한 값이 아니다. 오늘 환율만 쓰면 환율이 움직일 때마다 과거 원금이
 * 같이 흔들려 실제 계좌와 수십만 원씩 차이가 난다.
 *
 * resolveKrwRate(row)가 주어지면 매수 행마다 그 시점 환율로 원가를 쌓고,
 * 매도할 때는 남은 수량에 비례해 원가를 덜어낸다(이동평균).
 */
export const buildPositionFromTradeRows = (rows = [], { resolveKrwRate } = {}) => {
  const tracksKrwCost = typeof resolveKrwRate === 'function';
  const rateOf = (row) => {
    const rate = Number(resolveKrwRate?.(row));
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  };

  let quantity = 0;
  let cost = 0;
  let krwCost = 0;
  // 매수 시점 환율을 못 구한 수량. 남아 있으면 원금이 "정확"하다고 말하지 않는다.
  let unknownRateQuantity = 0;

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
        if (tracksKrwCost) {
          const rate = rateOf(row);
          if (rate > 0) {
            krwCost += row.quantity * row.price * rate;
          } else {
            unknownRateQuantity += row.quantity;
          }
        }
        return { ...row, pnl: 0 };
      }

      const averageCost = quantity > EPSILON ? cost / quantity : 0;
      const averageKrwCost = quantity > EPSILON ? krwCost / quantity : 0;
      const matchedQuantity = Math.min(row.quantity, quantity);
      const computedGrossPnl = matchedQuantity > EPSILON
        ? (row.price - averageCost) * matchedQuantity
        : row.pnl;
      const computedPnl = computedGrossPnl - row.brokerFee - row.sellTax;
      const hasCalculatedPnl = matchedQuantity > EPSILON;
      const resolvedPnl = row.hasRecordedPnl ? row.pnl : computedPnl;

      /**
       * 원화 실현손익도 매수 시점 환율 하나로만 계산한다.
       * 매도일 환율을 쓰면 주가가 아니라 환율이 손익을 만들어내는데,
       * 이 앱은 환차손익을 손익으로 치지 않는다(총 보유자산이 환율로 흔들리지 않게).
       */
      const buyRate = averageCost > EPSILON ? averageKrwCost / averageCost : 0;
      const removedKrwCost = averageKrwCost * matchedQuantity;
      const krwPnl = (tracksKrwCost && buyRate > 0 && matchedQuantity > EPSILON && unknownRateQuantity <= EPSILON)
        ? (row.price * matchedQuantity * buyRate) - removedKrwCost
        : null;

      quantity = Math.max(0, quantity - matchedQuantity);
      cost = Math.max(0, cost - (averageCost * matchedQuantity));
      krwCost = Math.max(0, krwCost - removedKrwCost);
      unknownRateQuantity = Math.max(0, unknownRateQuantity - matchedQuantity);
      if (quantity <= EPSILON) {
        quantity = 0;
        cost = 0;
        krwCost = 0;
        unknownRateQuantity = 0;
      }

      return {
        ...row,
        grossPnl: row.grossPnl || computedGrossPnl,
        pnl: resolvedPnl,
        krwPnl,
        pnlSource: row.hasRecordedPnl
          ? 'recorded'
          : (hasCalculatedPnl ? 'calculated' : 'unavailable'),
        matchedQuantity,
      };
    });

  return {
    rows: normalizedRows,
    quantity,
    averagePrice: quantity > EPSILON ? cost / quantity : 0,
    // 남아 있는 보유분의 실제 투입 원화(= 투자 원금).
    krwCost,
    // 모든 매수 행의 시점 환율을 알고 있을 때만 원금을 신뢰할 수 있다.
    hasExactKrwCost: tracksKrwCost && quantity > EPSILON && unknownRateQuantity <= EPSILON,
    firstBuyDate: normalizedRows.find((row) => row.side === 'buy')?.date || '',
    hasBuyRows: normalizedRows.some((row) => row.side === 'buy'),
  };
};

export const buildCanonicalTradeRows = ({ tradeLedger = [], trades = [], resolveKrwRate } = {}) => {
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
    .flatMap((rows) => buildPositionFromTradeRows(rows, { resolveKrwRate }).rows)
    .sort((a, b) => getRecordSortTime(b) - getRecordSortTime(a));
};

/**
 * 자산 키별로 "지금 보유분의 실제 투입 원화"를 계산해 돌려준다.
 * 회차가 다르면 키가 다르므로 매도 후 재매수한 물량의 원금도 섞이지 않는다.
 */
export const buildKrwCostBasisByAsset = (tradeLedger = [], resolveKrwRate) => {
  const rowsByAsset = new Map();
  (Array.isArray(tradeLedger) ? tradeLedger : []).forEach((row) => {
    const key = getTradeAssetKey(row);
    if (!rowsByAsset.has(key)) rowsByAsset.set(key, []);
    rowsByAsset.get(key).push(row);
  });

  const basisByKey = new Map();
  rowsByAsset.forEach((rows, key) => {
    basisByKey.set(key, buildPositionFromTradeRows(rows, { resolveKrwRate }));
  });

  return basisByKey;
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
