// 매매 기록 한 줄을 "화면에 보여주기 위해" 읽는 helper 모음.
// 원장 정합성 계산(tradeReconciliation)과 달리 정렬·필터·표시에만 쓰이며,
// 저장 형식이 여러 세대에 걸쳐 달라진 필드(side/type/action, pnl/realizedPnl)를
// 한 가지로 읽어 주는 것이 목적이다. App과 매매 기록 탭이 함께 쓴다.
import { getTradeRecordDate } from './tradeReconciliation.js';

export const getRecordDate = getTradeRecordDate;

export const getRecordPnl = (record) => Number(record.pnl ?? record.realizedPnl ?? 0);

export const getTradeSide = (record) => {
  if (record.side === 'buy' || record.type === 'buy') return 'buy';
  if (record.side === 'sell' || record.type === 'sell') return 'sell';
  if (record.action === '매수') return 'buy';
  if (record.action === '매도') return 'sell';
  if (record.sellDate || getRecordPnl(record) !== 0) return 'sell';
  return 'buy';
};

// 매매 기록 목록의 한 페이지 크기. 탭과 App의 초기 상태가 같은 값을 써야 한다.
export const TRADE_PAGE_SIZE = 10;
