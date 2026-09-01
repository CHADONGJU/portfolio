const toDateKey = (value) => String(value || '').slice(0, 10);

const getRecordYear = (record = {}) => Number(toDateKey(record.date).slice(0, 4));

const parseAmount = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * 금액 환산에 쓸 원화 환율.
 * 기록에 매수/매도 시점 환율(fxRate)이 남아 있으면 그것을 쓰고,
 * 없는 옛 기록만 오늘 환율로 근사한다(tradeSummary와 같은 규칙).
 */
const getRecordKrwRate = (record = {}, { exchangeRate, jpyKrwRate, currencyRates = {} } = {}) => {
  const storedRate = parseAmount(record.fxRate);
  if (storedRate > 0) return storedRate;

  const currency = String(record.currency || 'KRW').toUpperCase();
  if (currency === 'KRW') return 1;
  if (currency === 'USD') return parseAmount(exchangeRate) || parseAmount(currencyRates.USD) || 1350;
  if (currency === 'JPY') return parseAmount(jpyKrwRate) || parseAmount(currencyRates.JPY) || 9.5;
  return parseAmount(currencyRates[currency]) || 1;
};

/**
 * 매도 한 건의 원화 실현손익.
 * 표준 거래 행(buildCanonicalTradeRows)이 매수 시점 환율로 계산해 둔
 * krwPnl(환차손익 포함)을 그대로 쓰고, 환율을 모르는 옛 기록만
 * "손익 × 환율"로 근사한다(usePortfolioMetrics의 getRecordKrwPnl과 같은 규칙).
 */
const getRecordKrwPnl = (record = {}, rates) => {
  const exactKrwPnl = Number(record.krwPnl);
  if (record.krwPnl !== null && record.krwPnl !== undefined && Number.isFinite(exactKrwPnl)) {
    return { pnlKRW: exactKrwPnl, approximate: false };
  }
  return { pnlKRW: (Number(record.pnl) || 0) * getRecordKrwRate(record, rates), approximate: true };
};

/**
 * 연도별 매매 수익률(증권사 실현손익 화면과 같은 기준).
 *
 * 수익률 = 그 해 실현손익 ÷ 매도분 매수원가(총매도금액 − 실현손익).
 * "판 것에 들어간 돈 대비 얼마나 벌었나"이며, 증권사 앱의 기간 실현손익
 * 수익률과 같은 방식이다.
 * - 매수금액·매도금액은 시점 환율(fxRate)로 환산한 원화 체결 금액.
 * - 실현손익은 그 해 매도들의 원화 실현손익 합(수수료·세금 반영된 표준 행 기준).
 * - 배당과 평가손익(미실현)은 수익률에 넣지 않는다. 배당은 화면에서 참고용으로만
 *   따로 보여준다.
 * - 아직 팔지 않은 매수금액도 분모에 넣지 않는다 — 넣으면 같은 매도 성과가
 *   그 해에 얼마를 새로 샀느냐에 따라 흐려진다.
 */
export const calculateAnnualTradeReturn = ({
  rows = [],
  year,
  exchangeRate,
  jpyKrwRate,
  currencyRates = {},
} = {}) => {
  const numericYear = Number(year);
  const rates = { exchangeRate, jpyKrwRate, currencyRates };

  let buyKRW = 0;
  let sellKRW = 0;
  let profitKRW = 0;
  let buyCount = 0;
  let sellCount = 0;
  let approximate = false;

  rows.forEach((record) => {
    if (getRecordYear(record) !== numericYear) return;
    const quantity = parseAmount(record.quantity);
    const price = parseAmount(record.price);
    const amountKRW = price * quantity * getRecordKrwRate(record, rates);

    if (record.side === 'sell') {
      sellCount += 1;
      sellKRW += amountKRW;
      const { pnlKRW, approximate: isApproximate } = getRecordKrwPnl(record, rates);
      profitKRW += pnlKRW;
      approximate ||= isApproximate;
    } else {
      buyCount += 1;
      buyKRW += amountKRW;
    }
  });

  const tradeCount = buyCount + sellCount;
  if (tradeCount === 0) {
    return {
      year: numericYear,
      status: 'empty',
      returnPercent: null,
      buyKRW: 0,
      sellKRW: 0,
      soldCostKRW: 0,
      profitKRW: 0,
      buyCount: 0,
      sellCount: 0,
      tradeCount: 0,
      approximate: false,
    };
  }

  // 분모: 매도분 매수원가(매도금액 − 실현손익). 매도가 없는 해는 확정된 것이
  // 없으므로 수익률을 만들지 않는다(0%가 아니라 "아직 없음").
  const soldCostKRW = sellKRW - profitKRW;
  const returnPercent = soldCostKRW > 0 ? (profitKRW / soldCostKRW) * 100 : null;

  return {
    year: numericYear,
    status: Number.isFinite(returnPercent) ? 'ready' : 'empty',
    returnPercent: Number.isFinite(returnPercent) ? returnPercent : null,
    buyKRW,
    sellKRW,
    soldCostKRW,
    profitKRW,
    buyCount,
    sellCount,
    tradeCount,
    // 시점 환율이 없어 오늘 환율로 근사한 매도가 섞여 있으면 표시해 준다.
    approximate,
  };
};

export const getAnnualTradeYears = ({ rows = [], currentYear } = {}) => {
  const years = new Set([Number(currentYear) || new Date().getFullYear()]);
  rows.forEach((record) => {
    const year = getRecordYear(record);
    if (Number.isFinite(year) && year > 1900) years.add(year);
  });
  return [...years].sort((left, right) => right - left);
};
