import {
  OVERSEAS_STOCK_CAPITAL_GAINS_DEDUCTION_KRW,
  OVERSEAS_STOCK_CAPITAL_GAINS_TAX_RATE,
} from './tradeCosts.js';

const EPSILON = 0.000001;

const toNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isDomesticStockCategory = (category = '') => (
  String(category || '').includes('국내') && String(category || '').includes('주식')
);

/**
 * 해외주식 양도소득세 과세 대상.
 * 국내주식(비과세 소액주주)과 현금은 빼고, 그 밖의 해외 상장 종목만 통산한다.
 */
export const isOverseasCapitalGainsAsset = (record = {}) => {
  const category = String(record.category || '');
  if (isDomesticStockCategory(category)) return false;
  if (category.includes('현금')) return false;
  return true;
};

/**
 * 한 해의 해외주식 양도소득세(추정).
 *
 * - 같은 해의 모든 해외 종목 손익을 통산한다(이익과 손실을 서로 상계).
 * - 기본공제 250만원을 뺀 뒤 22%(양도소득세 20% + 지방소득세 2%)를 매긴다.
 * - 양도가액은 "매도일 환율", 취득가액은 "매수일 환율"로 각각 환산한다.
 *   앱 화면의 실현손익은 환차손익을 빼고 보여주지만, 세법은 환차익도 과세한다.
 * - 매도수수료·제세금은 필요경비로 빼준다.
 *
 * 환율을 모르는 옛 기록이 섞이면 estimated=true로 표시하고 현재 환율로 근사한다.
 */
export const calculateOverseasCapitalGainsTax = ({
  rows = [],
  year,
  resolveKrwRate = () => 0,
  deductionKRW = OVERSEAS_STOCK_CAPITAL_GAINS_DEDUCTION_KRW,
  taxRate = OVERSEAS_STOCK_CAPITAL_GAINS_TAX_RATE,
} = {}) => {
  const yearKey = String(Number(year) || '');
  let netGainKRW = 0;
  let gainKRW = 0;
  let lossKRW = 0;
  let tradeCount = 0;
  let estimated = false;
  // 취득가액을 어떤 방식으로도 알 수 없어 계산에서 뺀 매도 건.
  let unresolvedCount = 0;

  rows.forEach((row) => {
    if (String(row?.side) !== 'sell') return;
    if (!isOverseasCapitalGainsAsset(row)) return;
    const date = String(row.date || row.sellDate || '').slice(0, 10);
    if (!date.startsWith(`${yearKey}-`)) return;

    const rowQuantity = toNumber(row.quantity);
    const matched = toNumber(row.matchedQuantity);
    // 보유 원장과 짝지어진 수량만 과세 대상이다. 짝이 없으면 취득가액을 알 수 없다.
    const quantity = Number.isFinite(Number(row.matchedQuantity)) ? matched : rowQuantity;
    const price = toNumber(row.price ?? row.sellPrice);
    if (!(quantity > EPSILON)) {
      if (rowQuantity > EPSILON) unresolvedCount += 1;
      return;
    }

    const currency = String(row.currency || 'KRW').toUpperCase();
    const fallbackRate = currency === 'KRW' ? 1 : toNumber(resolveKrwRate(currency));

    // 양도가액: 매도일 환율. 원장에 남은 fxRate가 매도 체결일 환율이다.
    const recordedSellRate = toNumber(row.fxRate);
    const sellRate = currency === 'KRW'
      ? 1
      : (recordedSellRate > 0 ? recordedSellRate : fallbackRate);
    if (!(sellRate > 0)) {
      // 환율을 못 구하면 조용히 빼지 않고 "빠진 건"으로 세어 화면에 알린다.
      unresolvedCount += 1;
      return;
    }
    if (currency !== 'KRW' && !(recordedSellRate > 0)) estimated = true;

    /**
     * 취득가액.
     * 1) 매수일 환율로 쌓아둔 원화 원가가 있으면 그것이 정확하다.
     * 2) 없으면 현지 통화 취득원가를 매도일 환율로 환산해 근사한다(환차익이 빠진다).
     * 3) 둘 다 없으면 취득가액을 0으로 두는 대신 아예 계산에서 뺀다.
     *    0으로 두면 매도대금 전액이 양도차익이 되어 세금이 터무니없이 커진다.
     */
    const recordedCost = Number(row.krwCostRemoved);
    const hasRecordedCost = Number.isFinite(recordedCost) && recordedCost > 0;
    const nativeCost = toNumber(row.nativeCostRemoved)
      || (toNumber(row.buyPrice) * quantity)
      || Math.max(0, (price * quantity) - toNumber(row.grossPnl ?? row.pnl));
    let acquisitionKRW = 0;
    if (hasRecordedCost) {
      acquisitionKRW = recordedCost;
    } else if (nativeCost > EPSILON) {
      acquisitionKRW = nativeCost * sellRate;
      estimated = true;
    } else {
      unresolvedCount += 1;
      return;
    }

    const transferKRW = price * quantity * sellRate;
    // 수수료·제세금은 매도 행 전체 기준이므로 실제 매칭된 수량만큼만 필요경비로 뺀다.
    const expenseRatio = rowQuantity > EPSILON ? Math.min(1, quantity / rowQuantity) : 1;
    const sellExpensesKRW = (toNumber(row.brokerFee) + toNumber(row.sellTax)) * expenseRatio * sellRate;

    /**
     * 매수 수수료도 취득 부대비용이라 필요경비로 뺀다.
     * 원장에 매수일 환율로 환산해 둔 값이 있으면 그것을 쓰고,
     * 없으면 현지 통화 수수료를 매도일 환율로 근사한다.
     */
    const recordedKrwBuyFee = Number(row.krwBuyFeeRemoved);
    const buyFeeKRW = Number.isFinite(recordedKrwBuyFee) && recordedKrwBuyFee >= 0
      ? recordedKrwBuyFee
      : toNumber(row.buyFeeRemoved) * sellRate;

    const expensesKRW = sellExpensesKRW + buyFeeKRW;
    const rowGain = transferKRW - acquisitionKRW - expensesKRW;

    // 보유 원장과 짝이 맞지 않아 일부 수량만 계산한 매도. 남은 수량은 빠진 셈이다.
    if (rowQuantity - quantity > EPSILON) {
      estimated = true;
      unresolvedCount += 1;
    }

    netGainKRW += rowGain;
    if (rowGain >= 0) gainKRW += rowGain;
    else lossKRW += rowGain;
    tradeCount += 1;
  });

  const deduction = Math.max(0, toNumber(deductionKRW));
  const rate = Math.max(0, toNumber(taxRate));
  const taxBaseKRW = Math.max(0, netGainKRW - deduction);
  const taxKRW = taxBaseKRW * rate;

  return {
    year: Number(year) || null,
    tradeCount,
    unresolvedCount,
    netGainKRW,
    gainKRW,
    lossKRW,
    deductionKRW: deduction,
    taxBaseKRW,
    taxKRW,
    taxRate: rate,
    // 남은 기본공제. 연말 손익 확정 전에 얼마나 더 팔 수 있는지 가늠할 때 쓴다.
    remainingDeductionKRW: Math.max(0, deduction - Math.max(0, netGainKRW)),
    estimated,
  };
};
