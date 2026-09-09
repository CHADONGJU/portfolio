import { formatKoreanDate } from './dates.js';
import {
  compareTradeOrder,
  getTradeAssetKey,
  getTradeRound,
  normalizeTradeTicker,
} from './tradeReconciliation.js';
import { getDividendEligibilityDate } from './dividendDates.js';

const EPSILON = 1e-6;
const number = (value) => Number(String(value ?? '').replace(/,/g, ''));
const finite = (value) => Number.isFinite(number(value)) ? number(value) : 0;
const dateKey = (value) => String(value || '').slice(0, 10);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey(value));
const knownAmount = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(number(value)) && number(value) >= 0;

const sameAsset = (left, right) => {
  const leftTicker = normalizeTradeTicker(left.ticker);
  const rightTicker = normalizeTradeTicker(right.ticker);
  if (leftTicker && rightTicker) return leftTicker === rightTicker;
  const leftName = String(left.name || left.stockName || '').trim();
  const rightName = String(right.name || right.stockName || '').trim();
  return Boolean(leftName && leftName === rightName);
};

const resolveRate = (row, { exchangeRate, jpyKrwRate, currencyRates }) => {
  const currency = String(row.currency || 'KRW').toUpperCase();
  if (currency === 'KRW') return { rate: 1, approximate: false };
  if (finite(row.fxRate) > 0) return { rate: finite(row.fxRate), approximate: false };
  const fallback = currency === 'USD'
    ? finite(exchangeRate) || finite(currencyRates.USD) || 1350
    : currency === 'JPY'
      ? finite(jpyKrwRate) || finite(currencyRates.JPY) || 9.5
      : finite(currencyRates[currency]);
  return { rate: fallback > 0 ? fallback : 0, approximate: true };
};

/**
 * Recorded-capital cash-income ratio, not an annualized portfolio total return.
 * Both dividend modes use the same base: opening acquisition cost (including
 * purchase fees) plus this year's purchases. Reinvested purchases count again.
 * Missing acquisition history produces an unavailable result, never invented
 * opening capital or all-portfolio dividends divided by unrelated sold lots.
 */
export const calculateAnnualIncomeReturn = ({
  rows = [], year, dividendIncome = {}, includeDividends = false,
  exchangeRate, jpyKrwRate, currencyRates = {}, assets = [], today = new Date(),
} = {}) => {
  const numericYear = Number(year);
  const todayKey = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today : formatKoreanDate(today);
  const start = `${numericYear}-01-01`;
  const end = [`${numericYear}-12-31`, todayKey].sort()[0];
  const rates = { exchangeRate, jpyKrwRate, currencyRates };
  const eligibleRows = rows.filter((row) => validDate(row.date) && dateKey(row.date) <= end)
    .sort(compareTradeOrder);
  const rowsByAsset = new Map();
  const remainingPositions = [];
  eligibleRows.forEach((row) => {
    const key = getTradeAssetKey(row);
    if (!rowsByAsset.has(key)) rowsByAsset.set(key, []);
    rowsByAsset.get(key).push(row);
  });

  let openingCostKRW = 0;
  let periodBuyCostKRW = 0;
  let buyKRW = 0;
  let sellKRW = 0;
  let soldCostKRW = 0;
  let profitKRW = 0;
  let buyCount = 0;
  let sellCount = 0;
  let approximate = false;
  let basisUnavailableReason = '';
  const markUnavailable = (reason) => { basisUnavailableReason ||= reason; };
  if (end < start) markUnavailable('future-period');

  rowsByAsset.forEach((assetRows) => {
    let quantity = 0;
    let cost = 0;
    let feeCost = 0;
    let openingCaptured = false;
    let historyProblem = '';
    let historyApproximate = false;
    const captureOpening = () => {
      if (openingCaptured) return;
      openingCaptured = true;
      openingCostKRW += cost + feeCost;
      if (quantity > EPSILON) {
        if (historyProblem) markUnavailable(historyProblem);
        approximate ||= historyApproximate;
      }
    };
    assetRows.forEach((row) => {
      const inYear = dateKey(row.date) >= start;
      if (inYear) captureOpening();
      const count = finite(row.quantity);
      const price = finite(row.price);
      const { rate, approximate: rateApproximate } = resolveRate(row, rates);
      if (!(count > 0) || price < 0 || !Number.isFinite(number(row.price))) {
        historyProblem ||= 'missing-acquisition-cost';
        if (inYear) markUnavailable(historyProblem);
        return;
      }
      if (!rate) historyProblem ||= 'missing-exchange-rate';
      historyApproximate ||= rateApproximate;

      if (row.side !== 'sell') {
        if (!(price > 0)) historyProblem ||= 'missing-acquisition-cost';
        const purchase = count * price * rate;
        const purchaseFee = Math.max(0, finite(row.brokerFee)) * rate;
        quantity += count;
        cost += purchase;
        feeCost += purchaseFee;
        if (inYear) {
          buyCount += 1;
          buyKRW += purchase;
          periodBuyCostKRW += purchase + purchaseFee;
        }
      } else {
        if (count > quantity + EPSILON) historyProblem ||= 'missing-trade-history';
        const ratio = quantity > EPSILON ? Math.min(1, count / quantity) : 0;
        const computedCost = cost * ratio;
        const computedFee = feeCost * ratio;
        const removedCost = knownAmount(row.krwCostRemoved) ? number(row.krwCostRemoved) : computedCost;
        const removedFee = knownAmount(row.krwBuyFeeRemoved) ? number(row.krwBuyFeeRemoved) : computedFee;
        if (removedCost > cost + EPSILON || removedFee > feeCost + EPSILON) {
          historyProblem ||= 'inconsistent-acquisition-cost';
        }
        cost = Math.max(0, cost - removedCost);
        feeCost = Math.max(0, feeCost - removedFee);
        quantity = Math.max(0, quantity - count);
        if (quantity <= EPSILON) { cost = 0; feeCost = 0; }
        if (inYear) {
          sellCount += 1;
          sellKRW += count * price * rate;
          soldCostKRW += removedCost + removedFee;
          const exactPnl = row.krwPnl !== null && row.krwPnl !== undefined && row.krwPnl !== ''
            && Number.isFinite(number(row.krwPnl));
          profitKRW += exactPnl ? number(row.krwPnl) : finite(row.pnl) * rate;
          approximate ||= !exactPnl && String(row.currency || 'KRW').toUpperCase() !== 'KRW';
        }
      }
      if (inYear) {
        if (historyProblem) markUnavailable(historyProblem);
        approximate ||= historyApproximate;
      }
    });
    captureOpening();
    remainingPositions.push({ record: assetRows[0], quantity });
  });

  const purchases = eligibleRows.filter((row) => row.side !== 'sell' && finite(row.quantity) > 0);
  const dividendsKRW = Math.max(0, finite(dividendIncome.totalKRW));
  const dividendEvents = (dividendIncome.events || []).filter((event) => {
    const date = dateKey(event.date);
    return date >= start && date <= end;
  });
  dividendEvents.forEach((event) => {
    const eligibilityDate = dateKey(getDividendEligibilityDate(event) || event.date);
    if (!purchases.some((row) => sameAsset(row, event) && dateKey(row.date) <= eligibilityDate)) {
      markUnavailable('missing-dividend-cost');
    }
  });
  assets.forEach((asset) => {
    if (!(finite(asset.quantity) > 0) || asset.category === '현금') return;
    const acquired = dateKey(asset.buyDate);
    const relevant = validDate(acquired) ? acquired <= end : numericYear === Number(todayKey.slice(0, 4));
    if (!relevant) return;
    if (!purchases.some((row) => sameAsset(row, asset))) markUnavailable('missing-holding-cost');
    // Current quantities cannot establish historical inventory. For today's
    // holdings, however, an old closed round must not stand in for an unrecorded
    // current acquisition. Legacy holdings without a round use all matching lots.
    if (numericYear === Number(todayKey.slice(0, 4))) {
      const explicitRound = finite(asset.round ?? asset.positionRound) >= 1;
      const matchesHolding = (record) => sameAsset(record, asset)
        && (!explicitRound || getTradeRound(record) === getTradeRound(asset));
      const recordedQuantity = remainingPositions
        .filter((position) => matchesHolding(position.record))
        .reduce((sum, position) => sum + position.quantity, 0);
      const heldQuantity = assets.filter((holding) => matchesHolding(holding)
        && holding.category !== '현금' && finite(holding.quantity) > 0
        && (!validDate(holding.buyDate) || dateKey(holding.buyDate) <= end))
        .reduce((sum, holding) => sum + finite(holding.quantity), 0);
      if (recordedQuantity + EPSILON < heldQuantity) markUnavailable('missing-holding-cost');
    }
  });
  if (includeDividends && finite(dividendIncome.unconvertedCount) > 0) markUnavailable('missing-dividend-exchange-rate');
  approximate ||= Boolean(includeDividends && dividendIncome.approximate);
  const investedCostKRW = openingCostKRW + periodBuyCostKRW;
  const includedDividendsKRW = includeDividends ? dividendsKRW : 0;
  const returnIncomeKRW = profitKRW + includedDividendsKRW;
  if (!(investedCostKRW > EPSILON)) markUnavailable('missing-capital-base');
  const returnPercent = basisUnavailableReason ? null : returnIncomeKRW / investedCostKRW * 100;
  return {
    year: numericYear,
    status: Number.isFinite(returnPercent) ? 'ready' : 'insufficient',
    returnPercent: Number.isFinite(returnPercent) ? returnPercent : null,
    buyKRW, sellKRW, soldCostKRW, profitKRW, buyCount, sellCount,
    tradeCount: buyCount + sellCount,
    openingCostKRW, periodBuyCostKRW, investedCostKRW,
    dividendsKRW, includedDividendsKRW, returnIncomeKRW, includeDividends,
    basisUnavailableReason, approximate,
  };
};
