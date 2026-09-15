// 매수 내역 편집기의 상태와 저장 동작.
//
// 한 종목의 매수 건들을 표로 펼쳐 수량·단가·날짜·수수료를 직접 고치는 화면이다.
// 증권사 앱의 평단가와 앱의 평단가가 맞지 않을 때 사용자가 직접 맞추는 통로이고,
// 저장하면 그 종목의 매수 원장을 통째로 다시 쓴다.
//
// 조심할 점 두 가지:
// - 매수일을 바꾸면 그 날짜의 환율을 다시 받아와야 한다. 이전 날짜의 환율이
//   그대로 남으면 원금이 조용히 틀어진다(buyLotEditing의 resolveBuyLotFxRate).
// - 원장을 다시 쓸 때 기존 메모를 id로 다시 붙여 준다. 그러지 않으면 매수마다
//   적어 둔 메모가 저장 한 번에 전부 사라진다.
import { useMemo, useState } from 'react';
import { ACCOUNT_TYPE_GENERAL, normalizeAccountName, normalizeAccountType } from '../utils/accountTypes.js';
import { getAssetIdentity, isRecordForAsset, mergeUniqueAssets } from '../utils/assetIdentity.js';
import { editBuyLot, resolveBuyLotFxRate } from '../utils/buyLotEditing.js';
import { formatInputNumber, numbersMatch, parseNumber } from '../utils/formatters.js';
import { isDeletedMemoRecord } from '../utils/memoRecords.js';
import { deriveFeeRatePercent, roundTradeCost } from '../utils/tradeCosts.js';
import { getDateTimestampSeconds } from '../utils/dates.js';
import {
  getTradeRound,
  reconcileAssetsWithTradeLedger,
} from '../utils/tradeReconciliation.js';
import { getRecordDate, getTradeSide } from '../utils/tradeRecordView.js';

const isSameAssetRecord = (asset, record) => isRecordForAsset(record, asset);

// 원장을 다시 쓸 때 기존 메모를 되붙이기 위한 짝 찾기.
// 연결 id가 있으면 그것으로, 없는 옛 메모는 종목·날짜·매매구분·수량·단가로 맞춘다.
const findMatchingMemoForLedger = (entry, memos) => memos.find((memo) => {
  if (isDeletedMemoRecord(memo)) return false;
  if (memo.ledgerId && (String(memo.ledgerId) === String(entry.id) || String(memo.ledgerId) === String(entry.sourceId))) return true;
  if (entry.sourceId === `memo-${memo.id}`) return true;
  if (!entry.name || entry.name !== memo.name) return false;
  if (!entry.date || entry.date !== memo.date) return false;
  if (getTradeSide(entry) !== getTradeSide(memo)) return false;
  if (parseNumber(entry.quantity) && parseNumber(memo.quantity) && !numbersMatch(entry.quantity, memo.quantity)) return false;
  if (parseNumber(entry.price) && parseNumber(memo.price) && !numbersMatch(entry.price, memo.price)) return false;
  return true;
});

export const useBuyLotsEditor = ({
  tradeLedger,
  setTradeLedger,
  setAssets,
  setMemos,
  getBuyDateFxState,
  getAssetBuyLedgerRows,
  getAssetLedgerRows,
  defaultBuyDate,
  addLog,
}) => {
  const [selectedAssetToManageBuys, setSelectedAssetToManageBuys] = useState(null);
  const [buyLotDrafts, setBuyLotDrafts] = useState([]);
  const [accountTypeDraft, setAccountTypeDraft] = useState(ACCOUNT_TYPE_GENERAL);
  // 증권사 앱의 '투자 원금'을 그대로 넣어 맞추고 싶을 때 쓰는 수동 입력값.
  const [manualPurchaseKrwDraft, setManualPurchaseKrwDraft] = useState('');

  const managedAssetCurrency = selectedAssetToManageBuys?.currency || 'KRW';
  const buyLotDraftSummary = useMemo(() => {
    const totalQuantity = buyLotDrafts.reduce((sum, lot) => sum + parseNumber(lot.quantity), 0);
    const totalCost = buyLotDrafts.reduce((sum, lot) => (
      sum + parseNumber(lot.quantity) * parseNumber(lot.price)
    ), 0);
    const totalBuyFee = buyLotDrafts.reduce((sum, lot) => (
      sum + roundTradeCost(parseNumber(lot.brokerFee), managedAssetCurrency)
    ), 0);

    return {
      totalQuantity,
      averagePrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
      totalBuyFee,
    };
  }, [buyLotDrafts, managedAssetCurrency]);

  const buildBuyLotDrafts = (asset) => {
  const buyRows = getAssetBuyLedgerRows(asset, tradeLedger);
  const sourceRows = buyRows.length > 0
    ? buyRows
    : [{
      id: '',
      sourceId: '',
      date: asset.buyDate || defaultBuyDate,
      quantity: asset.quantity,
      price: asset.originalAveragePrice || asset.averagePrice,
    }];

  return sourceRows.map((row, index) => ({
    draftId: String(row.id || row.sourceId || `fallback-${asset.id}-${index}`),
    ledgerId: row.id ? String(row.id) : '',
    sourceId: row.sourceId || '',
    date: getRecordDate(row) || asset.buyDate || defaultBuyDate,
    quantity: String(row.quantity ?? ''),
    price: String(row.price ?? ''),
    // 이 매수 건에 실제로 적용된 환율. 0이면 아직 못 받아온 상태다.
    fxRate: Number(row.fxRate) > 0 ? Number(row.fxRate) : 0,
    /**
     * 유관기관제비용 요율은 체결된 시장·세션에 따라 건마다 다르다.
     * 요율을 들고 다니며 다시 계산하면 증권사가 실제로 뗀 금액과 어긋나므로,
     * 증권사 화면에 찍힌 수수료 금액을 그대로 들고 다닌다.
     */
    brokerFee: Number(row.brokerFee) || 0,
  }));
};

  const openBuyLotsModal = (asset) => {
  setSelectedAssetToManageBuys(asset);
  setBuyLotDrafts(buildBuyLotDrafts(asset));
  setAccountTypeDraft(normalizeAccountType(asset.accountType));
  setManualPurchaseKrwDraft(
    parseNumber(asset.manualPurchaseKRW) > 0
      ? formatInputNumber(String(Math.round(parseNumber(asset.manualPurchaseKRW))))
      : ''
  );
};

  const closeBuyLotsModal = () => {
  setSelectedAssetToManageBuys(null);
  setBuyLotDrafts([]);
  setAccountTypeDraft(ACCOUNT_TYPE_GENERAL);
  setManualPurchaseKrwDraft('');
};

  const updateBuyLotDraft = (draftId, field, value) => {
  setBuyLotDrafts(prevDrafts => prevDrafts.map(lot => (
    lot.draftId === draftId ? editBuyLot(lot, field, value) : lot
  )));
};

  const addBuyLotDraft = () => {
  setBuyLotDrafts(prevDrafts => [
    ...prevDrafts,
    {
      draftId: `new-${Date.now()}-${prevDrafts.length}`,
      ledgerId: '',
      sourceId: '',
      date: defaultBuyDate,
      quantity: '',
      price: '',
      fxRate: 0,
      brokerFee: 0,
    },
  ]);
};

  const removeBuyLotDraft = (draftId) => {
  setBuyLotDrafts(prevDrafts => prevDrafts.filter(lot => lot.draftId !== draftId));
};

  const handleSaveBuyLots = () => {
  if (!selectedAssetToManageBuys) return;
  if (buyLotDrafts.length === 0) {
    addLog('매수 기록은 최소 1개 이상 필요합니다.', 'error');
    return;
  }

  const normalizedDrafts = buyLotDrafts.map((lot) => ({
    ...lot,
    quantity: parseNumber(lot.quantity),
    price: parseNumber(lot.price),
  }));

  const hasInvalidLot = normalizedDrafts.some(lot => (
    !lot.date
    || getDateTimestampSeconds(lot.date) <= 0
    || lot.quantity <= 0
    || lot.price <= 0
  ));

  if (hasInvalidLot) {
    addLog('매수일, 수량, 단가를 모두 올바르게 입력해주세요.', 'error');
    return;
  }

  const totalBuyQuantity = normalizedDrafts.reduce((sum, lot) => sum + lot.quantity, 0);
  const totalSellQuantity = getAssetLedgerRows(selectedAssetToManageBuys, tradeLedger)
    .filter((entry) => getTradeSide(entry) === 'sell')
    .reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);

  if (totalBuyQuantity + 0.000001 < totalSellQuantity) {
    addLog('총 매수 수량이 이미 기록된 매도 수량보다 적을 수 없습니다.', 'error');
    return;
  }

  const now = new Date().toISOString();
  const existingBuyRows = getAssetBuyLedgerRows(selectedAssetToManageBuys, tradeLedger);
  const existingBuyRowsById = new Map(existingBuyRows.map(row => [String(row.id), row]));
  const hasUnresolvedChangedDate = normalizedDrafts.some((lot) => {
    const existingRow = existingBuyRowsById.get(String(lot.ledgerId));
    if (existingRow && getRecordDate(existingRow) === lot.date) return false;
    return resolveBuyLotFxRate({
      lot, existingRow, currency: selectedAssetToManageBuys.currency,
      lookedUpRate: getBuyDateFxState(selectedAssetToManageBuys.currency, lot.date).rate,
    }) <= 0;
  });
  if (hasUnresolvedChangedDate) {
    addLog('변경한 매수일의 환율을 확인하지 못했습니다. 조회 완료 후 다시 저장해 주세요.', 'error');
    return;
  }
  const sortedDrafts = [...normalizedDrafts].sort((a, b) => (
    getDateTimestampSeconds(a.date) - getDateTimestampSeconds(b.date)
  ));
  const nextBuyRows = sortedDrafts.map((lot, index) => {
    const existingRow = lot.ledgerId ? existingBuyRowsById.get(String(lot.ledgerId)) : null;
    const fxRate = resolveBuyLotFxRate({
      lot, existingRow, currency: selectedAssetToManageBuys.currency,
      lookedUpRate: getBuyDateFxState(selectedAssetToManageBuys.currency, lot.date).rate,
    });

    return {
      ...(existingRow || {}),
      id: existingRow?.id || `buy-${selectedAssetToManageBuys.id}-${Date.now()}-${index}`,
      sourceId: existingRow?.sourceId || lot.sourceId || undefined,
      assetId: selectedAssetToManageBuys.id,
      name: selectedAssetToManageBuys.name,
      ticker: selectedAssetToManageBuys.ticker || '',
      category: selectedAssetToManageBuys.category || '',
      currency: selectedAssetToManageBuys.currency || 'KRW',
      accountType: normalizeAccountType(accountTypeDraft),
      accountTypeSource: 'user',
      // 계좌 이름은 원장 키의 일부다. 빠지면 이 매수 건들이 다른 계좌 보유분으로 옮겨 간다.
      accountName: normalizeAccountName(selectedAssetToManageBuys.accountName),
      round: getTradeRound(selectedAssetToManageBuys),
      side: 'buy',
      action: '매수',
      quantity: lot.quantity,
      price: lot.price,
      date: lot.date,
      fxRate,
      pnl: 0,
      // 입력한 수수료 금액을 그대로 남기고, 요율은 그 금액에서 역산한다.
      brokerFee: roundTradeCost(parseNumber(lot.brokerFee), selectedAssetToManageBuys.currency),
      brokerFeeRatePercent: deriveFeeRatePercent(
        parseNumber(lot.brokerFee), lot.quantity * lot.price,
      ),
      brokerFeeRate: deriveFeeRatePercent(
        parseNumber(lot.brokerFee), lot.quantity * lot.price,
      ) / 100,
      createdAt: existingRow?.createdAt || now,
      updatedAt: now,
    };
  });

  const nextLedger = [
    ...tradeLedger.filter(entry => !(
      isSameAssetRecord(selectedAssetToManageBuys, entry)
      && getTradeSide(entry) === 'buy'
    )),
    ...nextBuyRows,
  ].sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)));

  setTradeLedger(nextLedger);
  // 원금 수동 입력값은 원장 재계산과 별개로 자산에 직접 붙여 둔다. 비우면 자동 계산으로 돌아간다.
  const manualPurchaseKRW = parseNumber(manualPurchaseKrwDraft);
  // 원금 칸을 그대로 두고 매수 수량만 고친 경우, 예전 총액이 그대로 남아 원금이
  // 부풀려졌다. 사용자가 원금을 직접 건드리지 않았다면 원장 재계산 결과를 따른다.
  const openedManualPurchaseKRW = Math.round(parseNumber(selectedAssetToManageBuys.manualPurchaseKRW));
  const keepsOpenedManualPurchase = Math.abs(manualPurchaseKRW - openedManualPurchaseKRW) <= 1;
  const manageIdentity = getAssetIdentity(selectedAssetToManageBuys);
  setAssets(prevAssets => reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), nextLedger).map((asset) => {
    if (asset.id !== selectedAssetToManageBuys.id && getAssetIdentity(asset) !== manageIdentity) return asset;
    const reconciledManualPurchaseKRW = parseNumber(asset.manualPurchaseKRW);
    const nextManualPurchaseKRW = keepsOpenedManualPurchase
      ? reconciledManualPurchaseKRW
      : manualPurchaseKRW;
    return {
      ...asset,
      accountType: normalizeAccountType(accountTypeDraft),
      accountTypeSource: 'user',
      manualPurchaseKRW: nextManualPurchaseKRW > 0 ? nextManualPurchaseKRW : null,
      updatedAt: new Date().toISOString(),
    };
  }));
  setMemos(prevMemos => {
    // 메모는 원장 행 id로 짝지어야 한다. 배열 인덱스로 맞추면 메모가 없는 매수 건이
    // 섞였을 때 앞뒤가 밀려서 다른 매수 건에 남의 메모가 옮겨 붙는다.
    const memoByLedgerId = new Map();
    existingBuyRows.forEach((row) => {
      const matched = findMatchingMemoForLedger(row, prevMemos);
      if (matched) memoByLedgerId.set(String(row.id), matched);
    });

    const reusedMemoIds = new Set();
    const nextBuyMemos = nextBuyRows.map((row, index) => {
      const existingMemo = memoByLedgerId.get(String(row.id)) || null;
      if (existingMemo) reusedMemoIds.add(existingMemo.id);

      return {
        ...(existingMemo || {}),
        id: existingMemo?.id || Date.now() + Math.random() + index,
        assetId: selectedAssetToManageBuys.id,
        name: selectedAssetToManageBuys.name,
        ticker: selectedAssetToManageBuys.ticker || '',
        category: selectedAssetToManageBuys.category || '',
        currency: selectedAssetToManageBuys.currency || 'KRW',
        accountType: normalizeAccountType(accountTypeDraft),
        accountTypeSource: 'user',
        accountName: normalizeAccountName(selectedAssetToManageBuys.accountName),
        round: getTradeRound(selectedAssetToManageBuys),
        side: 'buy',
        action: '매수',
        quantity: row.quantity,
        price: row.price,
        date: row.date,
        pnl: 0,
        memo: existingMemo?.memo || '',
        createdAt: existingMemo?.createdAt || now,
        updatedAt: now,
      };
    });

    // 실제로 이어붙인 메모만 교체한다. 매수 건이 줄어 짝을 잃은 메모는 지우지 않고
    // 남겨서, 과거 매매 기록에 '미연결 기록'으로 보이게 한다(내용 소실 방지).
    return [
      ...nextBuyMemos,
      ...prevMemos.filter(memo => !reusedMemoIds.has(memo.id)),
    ];
  });

  addLog(`'${selectedAssetToManageBuys.name}' 매수 기록을 저장했습니다.`, 'success');
  closeBuyLotsModal();
};

  return {
    selectedAssetToManageBuys,
    buyLotDrafts,
    accountTypeDraft,
    setAccountTypeDraft,
    managedAssetCurrency,
    buyLotDraftSummary,
    openBuyLotsModal,
    closeBuyLotsModal,
    updateBuyLotDraft,
    addBuyLotDraft,
    removeBuyLotDraft,
    handleSaveBuyLots,
  };
};
