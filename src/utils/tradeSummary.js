const parseNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getSide = (record = {}) => {
  if (record.side === 'sell' || record.type === 'sell' || record.action === '매도') return 'sell';
  if (record.side === 'buy' || record.type === 'buy' || record.action === '매수') return 'buy';
  if (record.sellDate || parseNumber(record.pnl ?? record.realizedPnl) !== 0) return 'sell';
  return 'buy';
};

const getKrwRate = (record, rates, usdRate, yenRate) => {
  const recordedRate = parseNumber(record.fxRate);
  if (recordedRate > 0) return recordedRate;

  const currency = String(record.currency || 'KRW').toUpperCase();
  if (currency === 'KRW') return 1;
  if (currency === 'USD') return parseNumber(usdRate) || parseNumber(rates.USD) || 1350;
  if (currency === 'JPY') return parseNumber(yenRate) || parseNumber(rates.JPY) || 9.5;
  return parseNumber(rates[currency]) || 1;
};

/**
 * 매도 한 건의 원화 실현손익.
 * usePortfolioMetrics의 getRecordKrwPnl과 같은 규칙이어야 포트폴리오 탭의
 * 실현손익 카드와 매매 기록 탭의 실현 손익이 같은 숫자를 보여준다.
 */
const getRecordKrwPnl = (record, rate) => {
  const recordedPnl = Number(record.pnl);
  if ((record.currency || 'KRW') === 'KRW'
    && record.pnl !== null
    && record.pnl !== undefined
    && Number.isFinite(recordedPnl)) {
    return recordedPnl;
  }
  const exactKrwPnl = Number(record.krwPnl);
  if (record.krwPnl !== null && record.krwPnl !== undefined && Number.isFinite(exactKrwPnl)) {
    return exactKrwPnl;
  }
  return parseNumber(record.pnl ?? record.realizedPnl) * rate;
};

export const buildTradeSummary = (
  records = [],
  exchangeRate = 1,
  yenRate = 1,
  rates = {},
) => records.reduce((summary, record) => {
  const quantity = parseNumber(record.quantity);
  const price = parseNumber(record.price ?? record.sellPrice ?? record.buyPrice);
  const rate = getKrwRate(record, rates, exchangeRate, yenRate);
  const side = getSide(record);

  if (side === 'buy') {
    summary.totalBuyQuantity += quantity;
    summary.totalBuyCount += 1;
    return summary;
  }

  summary.totalSellQuantity += quantity;
  summary.totalSellCount += 1;
  summary.totalSellAmount += price * quantity * rate;
  summary.totalProfit += getRecordKrwPnl(record, rate);
  return summary;
}, {
  totalBuyQuantity: 0,
  totalSellQuantity: 0,
  totalBuyCount: 0,
  totalSellCount: 0,
  totalSellAmount: 0,
  totalProfit: 0,
});
