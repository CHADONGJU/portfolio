const isDomesticStockCategory = (category = '') => (
  String(category || '').includes('국내') && String(category || '').includes('주식')
);

/**
 * 국내 상장 ETF/ETN은 매도해도 증권거래세를 내지 않는다(운용사가 대신 낸다).
 * 카테고리만으로는 구분할 수 없으므로 종목명의 브랜드로 판별한다.
 * 어디까지나 매도 모달의 "기본값"이라 사용자가 직접 고칠 수 있다.
 */
// 브랜드명은 반드시 이름 맨 앞에 오고 뒤에 공백/하이픈이 붙는다("KODEX 200").
// 이 구분이 없으면 'BNK금융지주', '파워로직스' 같은 일반 종목까지 ETF로 잘못 잡아
// 증권거래세를 0으로 만든다.
const ETF_BRAND_PATTERN = /^(KODEX|TIGER|KBSTAR|KOSEF|ARIRANG|HANARO|ACE|RISE|PLUS|SOL|TIMEFOLIO|WOORI|BNK|FOCUS|VITA|UNICORN|히어로즈|마이다스|마이티|파워)[\s\-·]/i;
const ETF_KEYWORD_PATTERN = /(^|[\s\-·(])(ETF|ETN)([\s\-·)]|$)/i;

export const isDomesticEtfLikeAsset = (asset = {}) => {
  if (!isDomesticStockCategory(asset.category)) return false;
  const name = String(asset.name || '').trim();
  return ETF_BRAND_PATTERN.test(name) || ETF_KEYWORD_PATTERN.test(name);
};

/**
 * 증권사 수수료 프리셋.
 *
 * 요율은 어디까지나 대략적인 기본값이다. 수수료가 면제된 계좌는 유관기관제비용만
 * 붙는데 그 요율이 체결된 시장·세션에 따라 건마다 달라진다(실계좌 대조에서 같은
 * 계좌의 매도 두 건이 0.0026925%와 0.0031765%로 갈렸다).
 * 증권사 화면과 원 단위까지 맞추려면 요율이 아니라 수수료 '금액'을 그대로 넣어야
 * 한다(calculateSellCosts의 brokerFeeAmount). 프리셋으로는 해결되지 않는다.
 */
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

/**
 * 증권거래세 + 농어촌특별세 합계(코스피·코스닥 동일).
 * 최신 세율이 위에 오도록 내림차순으로 둔다.
 */
const DOMESTIC_STOCK_SELL_TAX_RATES = [
  // 2026년 세율 인상은 2026-01-02 결제분부터 적용된다.
  // 앱의 sellDate는 매도 체결일이므로 2025-12-29 체결분부터 새 세율을 쓴다.
  { from: '2025-12-29', ratePercent: 0.2 },
  { from: '2025-01-01', ratePercent: 0.15 },
  { from: '2024-01-01', ratePercent: 0.18 },
  { from: '2023-01-01', ratePercent: 0.2 },
  { from: '2021-01-01', ratePercent: 0.23 },
  // 인하 시행일은 2019-06-03 매매분부터다(2019-05-30은 개정 공포일).
  { from: '2019-06-03', ratePercent: 0.25 },
];

// 2019-06-03 인하 이전 구간(코스피 0.15% + 농특세 0.15%).
const LEGACY_DOMESTIC_STOCK_SELL_TAX_RATE_PERCENT = 0.3;

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
  // 유관기관제비용은 0.0027033% 처럼 소수점 아래가 길다.
  // 네 자리에서 자르면 KRX 요율이 0.0036이 되어 수수료가 몇 원씩 어긋난다.
  return String(Number(value.toFixed(6)));
};

/**
 * 원화 거래의 수수료·제세금은 증권사가 원 단위로 절사한다.
 * 소수점을 남겨두면 앱 손익이 증권사 화면과 몇 원씩 계속 어긋난다.
 * 외화는 센트 단위로 부과되므로 절사하지 않는다.
 */
/**
 * "수수료 금액을 안다"와 "아직 안 넣었다"를 가른다.
 * 빈 칸을 0으로 읽으면 ₩ 모드로 바꾸는 순간 수수료가 0원이 되어버린다.
 * 반대로 사용자가 직접 넣은 0은 "수수료가 없었다"는 뜻이라 그대로 존중한다.
 */
export const resolveKnownFeeAmount = (value) => {
  if (value === null || value === undefined) return null;
  // 공백만 남은 칸은 빈 칸이고, '1,234'는 1234다. Number()는 둘 다 잘못 읽는다.
  const text = String(value).replace(/,/g, '').trim();
  if (text === '') return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

/**
 * 실제로 낸 수수료에서 요율을 역산한다.
 *
 * 수수료의 원본은 어디까지나 '금액'이다. 요율은 소수점을 자르는 순간 원 단위
 * 절사와 어긋나므로(예: 156원 → 0.0031746% → 다시 계산하면 155원), 기록을 보고
 * 무슨 요율이었는지 가늠하는 용도로만 쓴다. 어떤 코드도 이 요율로 수수료를
 * 다시 계산해서는 안 된다.
 */
export const deriveFeeRatePercent = (feeAmount, tradeAmount) => {
  const fee = Number(feeAmount);
  const amount = Number(tradeAmount);
  if (!Number.isFinite(fee) || !Number.isFinite(amount) || amount <= 0 || fee <= 0) return 0;
  return Number(((fee / amount) * 100).toFixed(7));
};

export const roundTradeCost = (amount, currency = 'KRW') => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return String(currency || 'KRW').toUpperCase() === 'KRW' ? Math.floor(value) : value;
};

export const getDomesticStockSellTaxRatePercent = (sellDate = '') => {
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(sellDate || '').slice(0, 10))
    ? String(sellDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const matched = DOMESTIC_STOCK_SELL_TAX_RATES.find(({ from }) => dateKey >= from);
  // 표에 없는 과거 날짜를 최신 세율로 계산하면 실제보다 세금이 적게 잡힌다.
  return matched?.ratePercent ?? LEGACY_DOMESTIC_STOCK_SELL_TAX_RATE_PERCENT;
};

export const getSellTaxRatePercent = (asset = {}, sellDate = '') => {
  if (!isDomesticStockCategory(asset.category)) return 0;
  // 국내 상장 ETF/ETN은 증권거래세 면제 대상이다.
  if (isDomesticEtfLikeAsset(asset)) return 0;
  return getDomesticStockSellTaxRatePercent(sellDate);
};

export const calculateSellCosts = ({
  category = '',
  currency = 'KRW',
  quantity = 0,
  sellPrice = 0,
  buyPrice = 0,
  brokerFeeRatePercent = 0,
  // 증권사 화면의 수수료 금액을 그대로 아는 경우. 요율보다 우선한다.
  brokerFeeAmount = null,
  sellTaxRatePercent = 0,
} = {}) => {
  const sellQuantity = Math.max(0, Number(quantity) || 0);
  const sellUnitPrice = Math.max(0, Number(sellPrice) || 0);
  const buyUnitPrice = Math.max(0, Number(buyPrice) || 0);
  const feeRate = Math.max(0, Number(brokerFeeRatePercent) || 0) / 100;
  const taxRate = Math.max(0, Number(sellTaxRatePercent) || 0) / 100;

  const grossSellAmount = sellUnitPrice * sellQuantity;
  const knownFeeAmount = resolveKnownFeeAmount(brokerFeeAmount);
  const brokerFee = knownFeeAmount === null
    ? roundTradeCost(grossSellAmount * feeRate, currency)
    : roundTradeCost(knownFeeAmount, currency);
  const appliesSellTax = isDomesticStockCategory(category);
  const sellTax = appliesSellTax ? roundTradeCost(grossSellAmount * taxRate, currency) : 0;
  const grossPnl = (sellUnitPrice - buyUnitPrice) * sellQuantity;
  // 매수 때 낸 수수료는 기록에 남아 있지 않아 여기서 빼지 못한다.
  const netPnl = grossPnl - brokerFee - sellTax;

  return {
    grossSellAmount,
    brokerFee,
    sellTax,
    totalCost: brokerFee + sellTax,
    grossPnl,
    netPnl,
    // 실제 차감된 수수료에서 역산한 요율. 기록된 금액을 늘 재현할 수 있어야 한다.
    feeRatePercent: deriveFeeRatePercent(brokerFee, grossSellAmount),
    sellTaxRatePercent: appliesSellTax ? taxRate * 100 : 0,
  };
};
