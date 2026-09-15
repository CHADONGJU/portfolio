// 이미 기록된 매매를 고치거나 지우는 동작.
//
// 기록은 두 세대가 섞여 있다. 지금 쓰는 매매 원장(tradeLedger)과, 원장이 생기기
// 전의 매도 기록(trades), 그리고 둘 중 어디에도 안 붙은 메모다. 한 줄을 고치면
// 세 곳을 함께 맞춰야 화면과 합계가 어긋나지 않는다.
//
// 지우기는 특히 조심스럽다. 매도 기록을 지우면 그때 팔았던 수량이 되살아나야
// 하는데, 전량 매도였다면 자산 자체가 목록에서 빠져 있어 원장으로 다시
// 만들어야 한다(reconcileAssetsAfterTradeDeletion).
import {
  getTradeAssetKey,
  getTradeRound,
  reconcileAssetsAfterTradeDeletion,
  reconcileAssetsWithTradeLedger,
} from '../utils/tradeReconciliation.js';
import {
  buildTradeRecordEditPatch,
  getEditableTradeFields,
  countUnmatchedSells,
  toLegacySellTradePatch,
  validateTradeRecordEdit,
} from '../utils/tradeRecordEditing.js';
import { isRecordForAsset, mergeUniqueAssets } from '../utils/assetIdentity.js';
import { normalizeAccountName, normalizeAccountType } from '../utils/accountTypes.js';
import { getRecordPnl, getTradeSide } from '../utils/tradeRecordView.js';
import { fetchKrwRateByDate } from '../services/marketData.js';
import { numbersMatch, parseNumber } from '../utils/formatters.js';

export const useTradeRecordEditing = ({
  trades,
  setTrades,
  tradeLedger,
  tradeLedgerRef,
  setTradeLedger,
  setAssets,
  setMemos,
  setExpandedTradeMemoId,
  addLog,
}) => {
  const removeTrade = (record, e) => {
    if (e) e.stopPropagation();
    const hasLinkedMemo = record.memoRecordId !== null && record.memoRecordId !== undefined;
    const isSellRecord = getTradeSide(record) === 'sell';

    if (record.sourceType === 'ledger') {
      const nextLedger = tradeLedger.filter(entry => entry.id !== record.id);
      setTradeLedger(nextLedger);
      setAssets(prevAssets => {
        const reconciledAssets = reconcileAssetsAfterTradeDeletion(
          mergeUniqueAssets(prevAssets),
          nextLedger,
          record,
        );
        return reconciledAssets.filter((asset) => {
          if (!isRecordForAsset(record, asset)) return true;
          return nextLedger.some(entry => isRecordForAsset(entry, asset) && getTradeSide(entry) === 'buy');
        });
      });
      setTrades(prevTrades => prevTrades.filter((trade) => {
        if (record.sourceId?.startsWith('trade-')) {
          const tradeId = record.sourceId.replace('trade-', '');
          if (String(trade.id) === tradeId) return false;
        }

        const isSameSellRecord =
          record.side === 'sell'
          && trade.name === record.name
          && trade.sellDate === record.date
          && numbersMatch(trade.quantity, record.quantity)
          && numbersMatch(trade.sellPrice, record.price);

        return !isSameSellRecord;
      }));
    } else {
      setTrades(prevTrades => prevTrades.filter(t => t.id !== record.id));
    }

    if (hasLinkedMemo) {
      const deletedAt = new Date().toISOString();
      setMemos((previous) => previous.map((memo) => (
        String(memo.id) === String(record.memoRecordId)
          ? { ...memo, memo: '', status: 'deleted', deletedAt, updatedAt: deletedAt }
          : memo
      )));
      setExpandedTradeMemoId('');
    }

    addLog(
      isSellRecord
        ? `매도 기록${hasLinkedMemo ? '과 연결된 메모를 ' : '을 '}삭제하고 보유 수량을 다시 계산했습니다.`
        : hasLinkedMemo
          ? '매수 기록과 연결된 메모를 함께 삭제하고 보유 수량을 다시 계산했습니다.'
          : '매수 기록을 삭제하고 보유 수량을 다시 계산했습니다.',
      'success',
    );
  };

  const removeTradeMemo = (record, e) => {
    if (e) e.stopPropagation();
    if (record.memoRecordId === null || record.memoRecordId === undefined) return;

    const deletedAt = new Date().toISOString();
    setMemos((previous) => previous.map((memo) => (
      String(memo.id) === String(record.memoRecordId)
        ? { ...memo, memo: '', status: 'deleted', deletedAt, updatedAt: deletedAt }
        : memo
    )));
    setExpandedTradeMemoId('');
    addLog(
      record.isUnlinkedMemo
        ? '보존된 미연결 기록을 삭제했습니다.'
        : '메모만 삭제했습니다. 매매 기록은 유지됩니다.',
      'success',
    );
  };

  /**
   * 과거 매매 기록의 거래일·단가·수수료·메모를 한 번에 고친다.
   * 원장(보유 수량·평단의 원본), 옛 매도 기록(trades), 연결된 메모가 같은 거래를 따로
   * 들고 있어서 셋을 함께 고쳐야 한다. 하나만 바꾸면 메모가 '미연결 기록'으로 떨어진다.
   * 저장하면 true를 돌려 편집기를 닫게 한다.
   */
  const updateTradeRecord = async (record, draft) => {
    const current = getEditableTradeFields(record);
    const nextDate = draft.date;
    const nextPrice = parseNumber(draft.price);
    // 빈 칸은 '수수료 없음'으로 본다. 0원도 실제로 있는 값이다.
    const nextBrokerFee = parseNumber(draft.brokerFee);
    const memoText = String(draft.memo || '').trim();
    const tradeChanged = nextDate !== current.date
      || Math.abs(nextPrice - current.price) > 1e-9
      || Math.abs(nextBrokerFee - current.brokerFee) > 1e-9;
    const memoChanged = memoText !== String(record.memo || '').trim();
    const hasMemoRecord = record.memoRecordId !== null && record.memoRecordId !== undefined;
    const action = current.side === 'sell' ? '매도' : '매수';

    if (!tradeChanged && !memoChanged) {
      setExpandedTradeMemoId('');
      return true;
    }
    if (tradeChanged) {
      const validationError = validateTradeRecordEdit({ date: nextDate, price: nextPrice, brokerFee: nextBrokerFee });
      if (validationError) {
        addLog(validationError, 'error');
        return false;
      }
    }

    const editsLedger = tradeChanged && !record.isUnlinkedMemo && record.sourceType === 'ledger';
    const editsLegacyTrade = tradeChanged && !record.isUnlinkedMemo && record.sourceType === 'trade';

    // 해외 종목의 거래일을 옮기면 원화 원금·손익도 그날 환율로 다시 잡아야 한다.
    let fxRate;
    const currency = String(record.currency || 'KRW').toUpperCase();
    if (editsLedger && currency !== 'KRW' && nextDate !== current.date) {
      const rate = await fetchKrwRateByDate(currency, nextDate).catch(() => 0);
      if (!(Number(rate) > 0)) {
        addLog('바꾼 거래일의 환율을 받아오지 못했습니다. 잠시 후 다시 저장해주세요.', 'error');
        return false;
      }
      fxRate = Number(rate);
    }

    const updatedAt = new Date().toISOString();
    const editValues = { date: nextDate, price: nextPrice, brokerFee: nextBrokerFee };
    const isSameLegacySell = (trade, legacyTradeId) => (
      (legacyTradeId && String(trade.id) === legacyTradeId)
      || (
        trade.name === record.name
        && trade.sellDate === current.date
        && numbersMatch(trade.quantity, record.quantity)
        && numbersMatch(trade.sellPrice, current.price)
      )
    );
    const editLegacySell = (trade) => ({
      ...trade,
      ...toLegacySellTradePatch(buildTradeRecordEditPatch({ ...trade, side: 'sell' }, editValues)),
      updatedAt,
    });
    let tradePatch = null;

    if (editsLedger) {
      // 환율을 기다리는 사이 원장이 바뀌었을 수 있으니 최신 원장에서 고친다.
      const currentLedger = tradeLedgerRef.current;
      const entry = currentLedger.find((row) => String(row.id) === String(record.id));
      if (!entry) {
        addLog('수정할 매매 기록을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error');
        return false;
      }
      tradePatch = buildTradeRecordEditPatch(entry, { ...editValues, fxRate });
      const nextLedger = currentLedger.map((row) => (row === entry ? { ...entry, ...tradePatch, updatedAt } : row));
      const assetKey = getTradeAssetKey(entry);
      const rowsOfAsset = (ledger) => ledger.filter((row) => getTradeAssetKey(row) === assetKey);
      if (countUnmatchedSells(rowsOfAsset(nextLedger)) > countUnmatchedSells(rowsOfAsset(currentLedger))) {
        addLog('이 날짜로 옮기면 그때까지 산 수량보다 판 수량이 많아집니다. 거래일을 확인해주세요.', 'error');
        return false;
      }

      setTradeLedger(nextLedger);
      setAssets((prevAssets) => reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), nextLedger));
      if (getTradeSide(entry) === 'sell') {
        const sourceId = String(entry.sourceId || '');
        const legacyTradeId = sourceId.startsWith('trade-') ? sourceId.slice('trade-'.length) : '';
        setTrades((prevTrades) => prevTrades.map((trade) => (
          isSameLegacySell(trade, legacyTradeId) ? editLegacySell(trade) : trade
        )));
      }
    } else if (editsLegacyTrade) {
      const legacyTrade = trades.find((trade) => String(trade.id) === String(record.id));
      if (!legacyTrade) {
        addLog('수정할 매매 기록을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error');
        return false;
      }
      tradePatch = buildTradeRecordEditPatch({ ...legacyTrade, side: 'sell' }, editValues);
      setTrades((prevTrades) => prevTrades.map((trade) => (
        String(trade.id) === String(record.id) ? editLegacySell(trade) : trade
      )));
    }

    const deletesMemo = memoChanged && !memoText && hasMemoRecord && !record.isUnlinkedMemo;
    if (hasMemoRecord) {
      setMemos((previous) => previous.map((memo) => {
        if (String(memo.id) !== String(record.memoRecordId)) return memo;
        // 미연결 메모는 그 자체가 기록이라 거래일·단가를 메모에 직접 고친다.
        const memoTradePatch = record.isUnlinkedMemo
          ? (tradeChanged ? buildTradeRecordEditPatch(memo, editValues) : null)
          : tradePatch;
        if (deletesMemo) {
          return { ...memo, ...memoTradePatch, memo: '', status: 'deleted', deletedAt: updatedAt, updatedAt };
        }
        return {
          ...memo,
          ...memoTradePatch,
          memo: memoChanged ? memoText : memo.memo,
          // 거래일을 옮기면 이름·날짜로는 더 이상 짝이 맞지 않으니 원장 id로 붙잡아 둔다.
          ledgerId: record.isUnlinkedMemo ? (memo.ledgerId || '') : record.id,
          updatedAt,
        };
      }));
    } else if (memoText) {
      const source = tradePatch ? { ...record, ...tradePatch } : record;
      setMemos((previous) => [{
        id: Date.now() + Math.random(),
        assetId: source.assetId ?? null,
        name: source.name,
        ticker: source.ticker || '',
        category: source.category || '',
        currency: source.currency || 'KRW',
        accountType: normalizeAccountType(source.accountType),
        accountName: normalizeAccountName(source.accountName),
        round: getTradeRound(source),
        side: current.side,
        action,
        quantity: source.quantity,
        price: getEditableTradeFields(source).price,
        date: getEditableTradeFields(source).date,
        pnl: getRecordPnl(source),
        grossPnl: source.grossPnl,
        brokerId: source.brokerId || '',
        brokerName: source.brokerName || '',
        brokerFeeRate: source.brokerFeeRate || 0,
        brokerFeeRatePercent: source.brokerFeeRatePercent || 0,
        brokerFee: source.brokerFee || 0,
        sellTaxRatePercent: source.sellTaxRatePercent || 0,
        sellTax: source.sellTax || 0,
        memo: memoText,
        ledgerId: record.id,
        createdAt: updatedAt,
        updatedAt,
      }, ...previous]);
    }

    setExpandedTradeMemoId('');
    if (tradeChanged) {
      addLog(
        editsLedger
          ? `${record.name} ${action} 기록을 고치고 보유 수량·평단·손익을 다시 계산했습니다.`
          : `${record.name} ${action} 기록을 고쳤습니다.`,
        'success',
      );
    } else {
      addLog(deletesMemo ? '메모를 삭제했습니다. 매매 기록은 유지됩니다.' : '매매 메모를 저장했습니다.', 'success');
    }
    return true;
  };

  return { removeTrade, removeTradeMemo, updateTradeRecord };
};
