const isDomesticStockCategory = (category = '') => (
  String(category || '').includes('국내') && String(category || '').includes('주식')
);

export const BROKER_FEE_PRESETS = [
  { id: 'custom', name: '직접 입력', domesticRatePercent: 0, overseasRatePercent: 0 },
  { id: 'toss', name: '토스증권', domesticRatePercent: 0.015, overseasRatePercent: 0.25 },
  { id: 'miraeasset', name: '미래에셋증권', domesticRatePercent: 0.014, overseasRatePercent: 0.25 },
  { id: 'shinhan', name: '신한증권', domesticRatePercent: 0.015, overseasRatePercent: 0.25 },
  { id: 'kb', name: 'KB증권', domesticRatePercent: 0.015, overseasRatePercent: 0.25 },
  { id: 'koreainvestment', name: '한국투자증권', domesticRatePercent: 0.014, overseasRatePercent: 0.25 },
];

export const DEFAULT_BROKER_ID = 'custom';
export const OVERSEAS_STOCK_CAPITAL_GAINS_DEDUCTION_KRW = 2500000;
export const OVERSEAS_STOCK_CAPITAL_GAINS_TAX_RATE = 0.22;

const DOMESTIC_STOCK_SELL_TAX_RATES = [
  // 2026년 세율 인상은 2026-01-02 결제분부터 적용된다.
  // 앱의 sellDate는 매도 체결일이므로 2025-12-29 체결분부터 새 세율을 쓴다.
  { from: '2025-12-29', ratePercent: 0.2 },
  { from: '2025-01-01', ratePercent: 0.15 },
  { from: '2024-01-01', ratePercent: 0.18 },
  { from: '2023-01-01', ratePercent: 0.2 },
];

export const getBrokerPreset = (brokerId) => (
  BROKER_FEE_PRESETS.find((broker) => broker.id === brokerId) || BROKER_FEE_PRESETS[0]
);

export const getBrokerFeeRatePercent = (brokerId, category) => {
  const preset = getBrokerPreset(brokerId);
  return isDomesticStockCategory(category)
    ? preset.domesticRatePercent
    : preset.overseasRatePercent;
};

export const formatFeeRateInput = (rate) => {
  const value = Number(rate);
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(4)));
};

export const getDomesticStockSellTaxRatePercent = (sellDate = '') => {
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(sellDate || '').slice(0, 10))
    ? String(sellDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const matched = DOMESTIC_STOCK_SELL_TAX_RATES.find(({ from }) => dateKey >= from);
  return matched?.ratePercent ?? 0.2;
};

export const getSellTaxRatePercent = (asset = {}, sellDate = '') => (
  isDomesticStockCategory(asset.category)
    ? getDomesticStockSellTaxRatePercent(sellDate)
    : 0
);

export const calculateSellCosts = ({
  category = '',
  quantity = 0,
  sellPrice = 0,
  buyPrice = 0,
  brokerFeeRatePercent = 0,
  sellTaxRatePercent = 0,
} = {}) => {
  const sellQuantity = Math.max(0, Number(quantity) || 0);
  const sellUnitPrice = Math.max(0, Number(sellPrice) || 0);
  const buyUnitPrice = Math.max(0, Number(buyPrice) || 0);
  const feeRate = Math.max(0, Number(brokerFeeRatePercent) || 0) / 100;
  const taxRate = Math.max(0, Number(sellTaxRatePercent) || 0) / 100;
  const grossSellAmount = sellUnitPrice * sellQuantity;
  const brokerFee = grossSellAmount * feeRate;
  const sellTax = isDomesticStockCategory(category)
    ? grossSellAmount * taxRate
    : 0;
  const grossPnl = (sellUnitPrice - buyUnitPrice) * sellQuantity;
  const netPnl = grossPnl - brokerFee - sellTax;

  return {
    grossSellAmount,
    brokerFee,
    sellTax,
    totalCost: brokerFee + sellTax,
    grossPnl,
    netPnl,
    feeRatePercent: feeRate * 100,
    sellTaxRatePercent: isDomesticStockCategory(category) ? taxRate * 100 : 0,
  };
};
