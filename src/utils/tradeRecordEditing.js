// 이미 기록된 매매를 고칠 때의 검증과 변경분 생성.
// 매수일을 매도일 뒤로 옮기는 것처럼 원장이 성립하지 않는 수정은 막는다.
import { deriveFeeRatePercent, roundTradeCost } from './tradeCosts.js';
import {
  buildPositionFromTradeRows,
  getTradeRecordSide,
  parseTradeNumber,
} from './tradeReconciliation.js';

const EPSILON = 0.000001;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const getRecordedBrokerFee = (record = {}) => (
  parseTradeNumber(record.brokerFee ?? record.fee ?? record.commission)
);

/**
 * 과거 매매 기록 편집 칸에 채울 거래일·단가·수수료.
 * 옛 매도 기록(trades)은 date/price 대신 sellDate/sellPrice를, buyPrice에는 평단을
 * 들고 있어서 매수·매도에 따라 읽을 필드를 골라야 한다.
 * 수수료는 그 거래 한 건에 낸 금액이다(매수 행은 매수 수수료, 매도 행은 매도 수수료).
 */
export const getEditableTradeFields = (record = {}) => {
  const side = getTradeRecordSide(record);
  const date = record.date || (side === 'sell' ? record.sellDate : record.buyDate) || '';
  const price = parseTradeNumber(record.price ?? (side === 'sell' ? record.sellPrice : record.buyPrice));
  return { side, date, price, brokerFee: getRecordedBrokerFee(record) };
};

const isValidTradeDate = (date = '') => {
  if (!DATE_PATTERN.test(String(date))) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

/** 수정값에 문제가 있으면 사용자에게 보여줄 문구를, 없으면 null을 돌려준다. */
export const validateTradeRecordEdit = ({ date, price, brokerFee = 0 } = {}) => {
  if (!isValidTradeDate(date)) return '거래일을 올바르게 입력해주세요.';
  if (!(parseTradeNumber(price) > 0)) return '단가를 올바르게 입력해주세요.';
  const fee = Number(String(brokerFee ?? '').replace(/,/g, '') || 0);
  if (!Number.isFinite(fee) || fee < 0) return '수수료를 올바르게 입력해주세요.';
  return null;
};

/**
 * 거래일·단가·수수료를 고친 기록에 덮어쓸 필드.
 *
 * 수수료는 증권사가 실제로 뗀 '금액'이 원본이다. 금액을 넘기지 않으면 기록된 금액을
 * 그대로 두고, 어느 쪽이든 요율은 새 거래금액에서 역산만 한다.
 * 매도의 실현손익은 처음부터 다시 계산하지 않고 기록된 값을 단가·수수료 차이만큼만 옮긴다.
 * 기록된 손익에는 매도 당시 반영한 매수 수수료나 증권사 확정값이 들어 있어서,
 * 다시 계산하면 사용자가 고치지 않은 부분까지 바뀐다.
 * 제세금은 매도금액에 비례하므로 기록된 세율이 있으면 새 매도금액으로 다시 계산한다.
 */
export const buildTradeRecordEditPatch = (record = {}, { date, price, brokerFee, fxRate } = {}) => {
  const { side, price: previousPrice, brokerFee: previousBrokerFee } = getEditableTradeFields(record);
  const quantity = parseTradeNumber(record.quantity);
  const nextPrice = parseTradeNumber(price);
  const currency = record.currency || 'KRW';
  const nextBrokerFee = brokerFee === undefined
    ? previousBrokerFee
    : roundTradeCost(parseTradeNumber(brokerFee), currency);
  const feeRatePercent = deriveFeeRatePercent(nextBrokerFee, quantity * nextPrice);
  const patch = {
    date,
    price: nextPrice,
    brokerFee: nextBrokerFee,
    brokerFeeRatePercent: feeRatePercent,
    brokerFeeRate: feeRatePercent / 100,
    ...(fxRate === undefined ? {} : { fxRate }),
  };
  if (side !== 'sell') return patch;

  const previousSellTax = parseTradeNumber(record.sellTax);
  const sellTaxRatePercent = parseTradeNumber(record.sellTaxRatePercent);
  const nextSellTax = sellTaxRatePercent > 0
    ? roundTradeCost(nextPrice * quantity * (sellTaxRatePercent / 100), currency)
    : previousSellTax;
  const grossDelta = (nextPrice - previousPrice) * quantity;
  const recordedPnl = parseTradeNumber(record.pnl ?? record.realizedPnl);
  const recordedGrossPnl = parseTradeNumber(record.grossPnl);
  // 손익을 비워 둔 누락 기록은 0으로 저장돼 있다. 여기에 차이만 더하면 없던 손익이
  // 생겨나므로, 손익이 한 번도 기록되지 않은 매도는 손익을 건드리지 않는다.
  const hasRecordedPnl = Math.abs(recordedPnl) > EPSILON || Math.abs(recordedGrossPnl) > EPSILON;

  return {
    ...patch,
    sellTax: nextSellTax,
    ...(hasRecordedPnl
      ? {
        pnl: recordedPnl + grossDelta
          - (nextSellTax - previousSellTax)
          - (nextBrokerFee - previousBrokerFee),
        grossPnl: recordedGrossPnl + grossDelta,
      }
      : {}),
  };
};

/** 옛 매도 기록(trades)은 거래일·단가를 sellDate/sellPrice로 들고 있다. */
export const toLegacySellTradePatch = ({ date, price, ...rest } = {}) => ({
  ...rest,
  sellDate: date,
  sellPrice: price,
});

/**
 * 그 시점까지의 매수 수량보다 많이 판 것으로 보이는 매도 건수.
 * 매수일을 매도일 뒤로 옮기거나 매도일을 첫 매수 앞으로 옮기면 늘어난다.
 * 옛 데이터에 이미 있던 불일치는 수정 전후를 비교해 걸러낸다.
 */
export const countUnmatchedSells = (rows = []) => (
  buildPositionFromTradeRows(rows).rows
    .filter((row) => row.side === 'sell' && row.matchedQuantity + EPSILON < row.quantity)
    .length
);
