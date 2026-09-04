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

/**
 * 사용자가 직접 확정한 투자 원금(manualPurchaseKRW)은 총액이라, 수량이 줄면
 * 같은 비율로 함께 줄여야 한다. 그러지 않으면 일부만 매도해도 남은 보유분의
 * 원금과 원화 평단가가 그대로 남아 수익률이 통째로 어긋난다.
 */
export const scaleManualPurchaseKRW = (manualPurchaseKRW, previousQuantity, nextQuantity) => {
  const amount = parseTradeNumber(manualPurchaseKRW);
  if (!(amount > 0)) return null;

  const after = parseTradeNumber(nextQuantity);
  // 전량 매도라 남길 원금이 없다.
  if (!(after > EPSILON)) return null;

  const before = parseTradeNumber(previousQuantity);
  // 이전 수량을 알 수 없으면 비율을 못 구한다. 지우지 말고 그대로 둔다.
  if (!(before > EPSILON)) return amount;
  if (Math.abs(before - after) <= EPSILON) return amount;

  const scaled = amount * (after / before);
  return scaled > 0 ? scaled : null;
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
  // 매도 시점에 실현손익에 이미 반영한 매수 수수료. 나중에 매수 기록을 고쳐도
  // 기록된 손익과 세금 필요경비가 서로 어긋나지 않도록 이 값을 우선한다.
  const recordedBuyFeeApplied = record.buyFeeApplied;
  const hasRecordedBuyFeeApplied = recordedBuyFeeApplied !== null
    && recordedBuyFeeApplied !== undefined
    && recordedBuyFeeApplied !== ''
    && Number.isFinite(Number(recordedBuyFeeApplied));
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
    // 매수 행의 brokerFee는 그 매수 때 낸 수수료다(매도 행은 매도 수수료).
    buyFeeApplied: parseTradeNumber(recordedBuyFeeApplied),
    hasRecordedBuyFeeApplied,
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
  // 아직 팔지 않은 물량에 붙어 있는 매수 수수료(취득 부대비용).
  // 평단가는 증권사 화면과 맞추기 위해 수수료를 빼고 계산하고, 수수료는 여기에 따로 쌓아
  // 매도할 때 판 수량만큼만 손익에서 덜어낸다.
  let buyFeeCost = 0;
  let krwBuyFeeCost = 0;
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
        buyFeeCost += row.brokerFee;
        if (tracksKrwCost) {
          const rate = rateOf(row);
          if (rate > 0) {
            krwCost += row.quantity * row.price * rate;
            krwBuyFeeCost += row.brokerFee * rate;
          } else {
            unknownRateQuantity += row.quantity;
          }
        }
        return { ...row, pnl: 0 };
      }

      // 매도로 물량을 덜어내기 '전'의 미상 환율 수량. 아래에서 값이 바뀌므로 먼저 붙잡아 둔다.
      const unknownRateQuantityBeforeSale = unknownRateQuantity;
      const averageCost = quantity > EPSILON ? cost / quantity : 0;
      const averageKrwCost = quantity > EPSILON ? krwCost / quantity : 0;
      const matchedQuantity = Math.min(row.quantity, quantity);
      const soldRatio = quantity > EPSILON ? Math.min(1, matchedQuantity / quantity) : 0;
      // 판 수량만큼의 매수 수수료. 증권사 실현손익과 같게 하려면 이것도 빼야 한다.
      const proratedBuyFee = buyFeeCost * soldRatio;
      const proratedKrwBuyFee = krwBuyFeeCost * soldRatio;
      // 기록이 있으면 그것이 실제로 손익에 반영된 값이다.
      const appliedBuyFee = row.hasRecordedBuyFeeApplied ? row.buyFeeApplied : proratedBuyFee;
      const computedGrossPnl = matchedQuantity > EPSILON
        ? (row.price - averageCost) * matchedQuantity
        : row.pnl;
      const computedPnl = computedGrossPnl - row.brokerFee - row.sellTax - appliedBuyFee;
      const hasCalculatedPnl = matchedQuantity > EPSILON;
      const resolvedPnl = row.hasRecordedPnl ? row.pnl : computedPnl;

      /**
       * 원화 실현손익도 매수 시점 환율 하나로만 계산한다.
       * 매도일 환율을 쓰면 주가가 아니라 환율이 손익을 만들어내는데,
       * 이 앱은 환차손익을 손익으로 치지 않는다(총 보유자산이 환율로 흔들리지 않게).
       */
      const buyRate = averageCost > EPSILON ? averageKrwCost / averageCost : 0;
      const removedKrwCost = averageKrwCost * matchedQuantity;
      /**
       * 원화 환산은 '수수료를 낸 시점의 환율'로 해야 한다.
       * buyRate는 매수금액 기준 가중평균이라, 수수료가 특정 매수 건에 몰려 있으면
       * (최소 수수료, 무료 이벤트, 증권사 변경 등) 실제와 어긋난다.
       * 그래서 비례 배분값의 환율 구성을 유지한 채 금액만 기록값에 맞춰 늘리고 줄인다.
       */
      const krwBuyFeeApplied = proratedBuyFee > EPSILON
        ? proratedKrwBuyFee * (appliedBuyFee / proratedBuyFee)
        : appliedBuyFee * buyRate;
      const krwCharges = ((row.brokerFee + row.sellTax) * buyRate) + krwBuyFeeApplied;
      const krwPnl = (tracksKrwCost && buyRate > 0 && matchedQuantity > EPSILON && unknownRateQuantity <= EPSILON)
        ? (row.price * matchedQuantity * buyRate) - removedKrwCost - krwCharges
        : null;

      /**
       * 이동평균이므로 매도분에는 환율을 아는 물량과 모르는 물량이 같은 비율로 섞여 있다.
       * 매도 수량만큼 통째로 빼면, 환율 미상 물량이 실제보다 빨리 0이 되면서 남은 보유분의
       * 원금이 "정확"하다고 잘못 표시된다(원금 과소 계상).
       */
      const remainingRatio = quantity > EPSILON
        ? Math.max(0, quantity - matchedQuantity) / quantity
        : 0;

      quantity = Math.max(0, quantity - matchedQuantity);
      cost = Math.max(0, cost - (averageCost * matchedQuantity));
      krwCost = Math.max(0, krwCost - removedKrwCost);
      // 남은 보유분에서 덜어내는 것은 언제나 비례 배분값이다(총액이 어긋나지 않게).
      buyFeeCost = Math.max(0, buyFeeCost - proratedBuyFee);
      krwBuyFeeCost = Math.max(0, krwBuyFeeCost - proratedKrwBuyFee);
      unknownRateQuantity = Math.max(0, unknownRateQuantity * remainingRatio);
      if (quantity <= EPSILON) {
        quantity = 0;
        cost = 0;
        krwCost = 0;
        buyFeeCost = 0;
        krwBuyFeeCost = 0;
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
        // 양도소득세는 매수일 환율로 환산한 취득가액이 필요하다.
        // 매수 시점 환율을 모르는 물량이 섞여 있으면 원가가 실제보다 작게 쌓여 있으므로,
        // 그때는 넘기지 않고(null) 세금 계산이 근사값을 쓰도록 둔다.
        krwCostRemoved: (buyRate > 0 && unknownRateQuantityBeforeSale <= EPSILON)
          ? removedKrwCost
          : null,
        // 환율과 무관한 현지 통화 취득원가. 원화 원가를 모를 때의 대비책이다.
        nativeCostRemoved: matchedQuantity > EPSILON ? averageCost * matchedQuantity : null,
        // 이번 매도분에 배분된 매수 수수료. 양도소득세 필요경비이기도 하다.
        buyFeeRemoved: appliedBuyFee,
        krwBuyFeeRemoved: (buyRate > 0 && unknownRateQuantityBeforeSale <= EPSILON)
          ? krwBuyFeeApplied
          : null,
      };
    });

  return {
    rows: normalizedRows,
    quantity,
    averagePrice: quantity > EPSILON ? cost / quantity : 0,
    // 남아 있는 보유분의 실제 투입 원화(= 투자 원금).
    krwCost,
    // 남은 보유분에 붙어 있는 매수 수수료.
    buyFeeCost,
    krwBuyFeeCost,
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
        manualPurchaseKRW: scaleManualPurchaseKRW(
          asset.manualPurchaseKRW,
          parseTradeNumber(asset.quantity),
          nextQuantity,
        ),
        buyDate: position.firstBuyDate || asset.buyDate,
        updatedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  return changed ? reconciled : assets;
};

/**
 * 잘못 입력한 매도 기록을 지웠을 때 보유 종목을 원장 기준으로 되돌린다.
 *
 * 부분 매도였다면 기존 자산을 reconcileAssetsWithTradeLedger가 바로잡을 수 있지만,
 * 전량 매도였다면 자산 자체가 목록에서 빠져 있어 갱신할 대상이 없다. 그 경우에만
 * 남아 있는 매수 원장으로 최소 자산 정보를 재구성한다. 현재가는 곧 시세 동기화가
 * 채우므로, 그 전까지 잘못된 손익을 만들지 않도록 원장 평단으로 시작한다.
 */
export const reconcileAssetsAfterTradeDeletion = (
  assets = [],
  tradeLedger = [],
  deletedRecord = {},
) => {
  const reconciledAssets = reconcileAssetsWithTradeLedger(assets, tradeLedger);
  if (getTradeRecordSide(deletedRecord) !== 'sell') return reconciledAssets;

  const deletedAssetKey = getTradeAssetKey(deletedRecord);
  if (reconciledAssets.some((asset) => getTradeAssetKey(asset) === deletedAssetKey)) {
    return reconciledAssets;
  }

  const remainingRows = tradeLedger.filter((row) => getTradeAssetKey(row) === deletedAssetKey);
  const position = buildPositionFromTradeRows(remainingRows);
  if (!position.hasBuyRows || position.quantity <= EPSILON) return reconciledAssets;

  const firstBuyRow = position.rows.find((row) => row.side === 'buy') || deletedRecord;
  const sameStockAsset = reconciledAssets.find((asset) => (
    getTradeAssetBaseKey(asset) === getTradeAssetBaseKey(deletedRecord)
  ));
  const averagePrice = position.averagePrice;
  const currency = firstBuyRow.currency || deletedRecord.currency || 'KRW';
  const now = new Date().toISOString();

  const restoredAsset = {
    id: firstBuyRow.assetId ?? deletedRecord.assetId ?? `restored-${deletedAssetKey}`,
    name: firstBuyRow.name || deletedRecord.name || '',
    ticker: firstBuyRow.ticker || deletedRecord.ticker || '',
    category: firstBuyRow.category || deletedRecord.category || (currency === 'KRW' ? '국내주식' : '해외주식'),
    currency,
    accountType: firstBuyRow.accountType || deletedRecord.accountType || '',
    accountTypeSource: firstBuyRow.accountTypeSource || deletedRecord.accountTypeSource || '',
    round: getTradeRound(deletedRecord),
    quantity: Number(position.quantity.toFixed(8)),
    averagePrice,
    originalAveragePrice: averagePrice,
    currentPrice: sameStockAsset?.currentPrice || averagePrice,
    originalCurrency: currency,
    originalCurrentPrice: sameStockAsset?.originalCurrentPrice || averagePrice,
    manualPurchaseKRW: null,
    buyDate: position.firstBuyDate,
    createdAt: firstBuyRow.createdAt || now,
    updatedAt: now,
  };

  return [...reconciledAssets, restoredAsset];
};

/**
 * 매수 원장상 보유 수량이 남아 있지만 자산 목록에는 없는 포지션을 복구한다.
 *
 * 예전 화면을 열어둔 채 전량 매도 기록을 삭제한 경우처럼, 삭제 이벤트 시점의 복구를
 * 이미 놓친 데이터도 다음 앱 로드에서 고칠 수 있어야 한다. 자산 삭제 기능은 연결된
 * 원장까지 함께 지우므로 사용자가 명시적으로 삭제한 자산을 되살리지는 않는다.
 */
export const recoverMissingAssetsFromTradeLedger = (assets = [], tradeLedger = []) => {
  if (!Array.isArray(tradeLedger) || tradeLedger.length === 0) return assets;

  let recoveredAssets = reconcileAssetsWithTradeLedger(assets, tradeLedger);
  const rowsByAsset = new Map();
  tradeLedger.forEach((row) => {
    const key = getTradeAssetKey(row);
    if (!rowsByAsset.has(key)) rowsByAsset.set(key, []);
    rowsByAsset.get(key).push(row);
  });

  rowsByAsset.forEach((rows, assetKey) => {
    if (recoveredAssets.some((asset) => getTradeAssetKey(asset) === assetKey)) return;

    const position = buildPositionFromTradeRows(rows);
    if (!position.hasBuyRows || position.quantity <= EPSILON) return;

    const firstBuyRow = position.rows.find((row) => row.side === 'buy');
    if (!firstBuyRow || firstBuyRow.category === '현금') return;

    const sameStockAsset = recoveredAssets.find((asset) => (
      getTradeAssetBaseKey(asset) === getTradeAssetBaseKey(firstBuyRow)
    ));
    const averagePrice = position.averagePrice;
    const currency = firstBuyRow.currency || 'KRW';
    const preferredId = firstBuyRow.assetId ?? `restored-${assetKey}`;
    const idAlreadyUsed = recoveredAssets.some((asset) => String(asset.id) === String(preferredId));
    const now = new Date().toISOString();

    recoveredAssets = [...recoveredAssets, {
      id: idAlreadyUsed ? `restored-${assetKey}` : preferredId,
      name: firstBuyRow.name || '',
      ticker: firstBuyRow.ticker || '',
      category: firstBuyRow.category || (currency === 'KRW' ? '국내주식' : '해외주식'),
      currency,
      accountType: firstBuyRow.accountType || '',
      accountTypeSource: firstBuyRow.accountTypeSource || '',
      round: getTradeRound(firstBuyRow),
      quantity: Number(position.quantity.toFixed(8)),
      averagePrice,
      originalAveragePrice: averagePrice,
      currentPrice: sameStockAsset?.currentPrice || averagePrice,
      originalCurrency: currency,
      originalCurrentPrice: sameStockAsset?.originalCurrentPrice || averagePrice,
      manualPurchaseKRW: null,
      buyDate: position.firstBuyDate,
      createdAt: firstBuyRow.createdAt || now,
      updatedAt: now,
    }];
  });

  return recoveredAssets;
};
