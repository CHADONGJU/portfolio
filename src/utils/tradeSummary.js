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

export const buildTradeSummary = (
  records = [],
  exchangeRate = 1,
  yenRate = 1,
  rates = {},
) => records.reduce((summary, record) => {
  const quantity = parseNumber(record.quantity);
  const price = parseNumber(record.price ?? record.sellPrice ?? record.buyPrice);
  const pnl = parseNumber(record.pnl ?? record.realizedPnl);
  const rate = getKrwRate(record, rates, exchangeRate, yenRate);
  const side = getSide(record);

  if (side === 'buy') {
    summary.totalBuyQuantity += quantity;
    summary.totalBuyCount += 1;
  } else {
    summary.totalSellQuantity += quantity;
    summary.totalSellCount += 1;
    summary.totalSellAmount += price * quantity * rate;
  }

  summary.totalProfit += pnl * rate;
  return summary;
}, {
  totalBuyQuantity: 0,
  totalSellQuantity: 0,
  totalBuyCount: 0,
  totalSellCount: 0,
  totalSellAmount: 0,
  totalProfit: 0,
});
