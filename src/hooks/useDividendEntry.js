// 실제 입금 배당 기록(수동 입력·사진 가져오기)을 다루는 훅.
//
// 앱의 배당은 두 종류다. 하나는 배당락·주당배당금으로 앱이 계산한 "공식" 값이고,
// 다른 하나는 사용자가 증권사 입금 내역을 보고 직접 넣은 "확정" 값이다. 확정
// 기록은 같은 회차의 공식 값을 대체하며 배당 합계와 연간 수익률에 그대로 들어간다.
// 사진에서 읽어온 내역은 검증용이라 확정으로 올리지 않는다.
//
// 저장되는 confirmedDividends는 클라우드 동기화와 묶여 있어 App이 들고 있고,
// 이 훅은 입력 폼 상태만 직접 소유한다.
import { useMemo, useRef, useState } from 'react';
import { isRemovedAssetCategory } from '../constants.js';
import { buildDividendCalculationAssets } from '../utils/dividendHoldings.js';
import { mergeDividendRecords, mergeUniqueDividends } from '../utils/dividendRecords.js';
import { parseNumber } from '../utils/formatters.js';

export const useDividendEntry = ({
  assets,
  tradeLedger,
  setConfirmedDividends,
  defaultBuyDate,
  addLog,
}) => {
  const [isAddingDividend, setIsAddingDividend] = useState(false);
  const dividendImportInputRef = useRef(null);
  const [actualDividendForm, setActualDividendForm] = useState({
    assetId: '',
    name: '',
    ticker: '',
    category: '국내주식',
    date: defaultBuyDate,
    amount: '',
    quantity: '',
    currency: 'KRW',
  });

  const dividendEntryAssets = useMemo(() => (
    buildDividendCalculationAssets(assets, tradeLedger)
      .filter((asset) => !isRemovedAssetCategory(asset.category))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
  ), [assets, tradeLedger]);

  const openActualDividendForm = () => {
    const firstAsset = dividendEntryAssets[0];
    setActualDividendForm({
      assetId: firstAsset ? String(firstAsset.id) : '',
      name: firstAsset?.name || '',
      ticker: firstAsset?.ticker || '',
      category: firstAsset?.category || '국내주식',
      date: defaultBuyDate,
      amount: '',
      quantity: firstAsset?.quantity || '',
      currency: firstAsset?.currency || 'KRW',
    });
    setIsAddingDividend(true);
  };

  const handleActualDividendAssetChange = (assetId) => {
    const asset = dividendEntryAssets.find((candidate) => String(candidate.id) === String(assetId));
    setActualDividendForm((previous) => ({
      ...previous,
      assetId,
      name: assetId === '__manual__' ? '' : asset?.name || previous.name,
      ticker: assetId === '__manual__' ? '' : asset?.ticker || previous.ticker,
      category: assetId === '__manual__'
        ? (previous.currency === 'KRW' ? '국내주식' : '해외주식')
        : asset?.category || previous.category,
      quantity: asset?.quantity || '',
      currency: asset?.currency || previous.currency,
    }));
  };

  const handleAddActualDividend = () => {
    const selectedAsset = dividendEntryAssets.find((candidate) => (
      String(candidate.id) === String(actualDividendForm.assetId)
    ));
    const manualName = String(actualDividendForm.name || actualDividendForm.ticker || '').trim();
    const asset = selectedAsset || (actualDividendForm.assetId === '__manual__' && manualName ? {
      id: `manual-dividend-${String(actualDividendForm.ticker || manualName).trim().toUpperCase()}`,
      name: manualName,
      ticker: String(actualDividendForm.ticker || '').trim().toUpperCase(),
      category: actualDividendForm.category || (actualDividendForm.currency === 'KRW' ? '국내주식' : '해외주식'),
      currency: actualDividendForm.currency || 'KRW',
    } : null);
    const amount = parseNumber(actualDividendForm.amount);
    const quantity = parseNumber(actualDividendForm.quantity);
    if (!asset || !actualDividendForm.date || amount <= 0) {
      addLog('종목·입금일·실제 입금액을 확인해주세요.', 'error');
      return;
    }

    const dividend = {
      id: `actual-${Date.now()}`,
      assetId: asset.id,
      name: asset.name,
      ticker: asset.ticker || '',
      category: asset.category || '',
      currency: actualDividendForm.currency || asset.currency || 'KRW',
      quantity: quantity > 0 ? quantity : undefined,
      perShareNetAmount: quantity > 0 ? amount / quantity : undefined,
      amount,
      date: actualDividendForm.date,
      actualPaymentDate: actualDividendForm.date,
      period: actualDividendForm.date.slice(0, 7),
      dateBasis: 'payment',
      status: 'actual',
      recordType: 'actual',
      confirmationSource: 'user-entry',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setConfirmedDividends((previous) => mergeUniqueDividends([dividend], previous));
    setIsAddingDividend(false);
    addLog(`'${asset.name}' 실제 입금 배당을 반영했습니다.`, 'success');
  };

  const handleConfirmedDividendImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const sourceRows = parsed?.data?.confirmedDividends || parsed?.confirmedDividends;
      if (!Array.isArray(sourceRows)) throw new Error('confirmedDividends array not found');

      const validRows = sourceRows.filter((row) => (
        row
        && row.name
        && row.currency
        && Number(row.amount) >= 0
        && (row.actualPaymentDate || row.paymentDate || row.date || row.period)
      ));
      if (validRows.length === 0) throw new Error('no valid dividend records');

      setConfirmedDividends((previous) => mergeDividendRecords(validRows, previous));
      addLog(`실제 입금 배당 ${validRows.length.toLocaleString()}건을 복구 파일에서 불러왔습니다.`, 'success');
    } catch (error) {
      console.error('Confirmed dividend import failed:', error);
      addLog('실제 배당 복구 파일을 읽지 못했습니다.', 'error');
    }
  };

  const removeConfirmedDividend = (dividendId) => {
    const deletedAt = new Date().toISOString();
    setConfirmedDividends((previous) => previous.map((dividend) => (
      dividend.id === dividendId
        ? { ...dividend, status: 'deleted', deletedAt, updatedAt: deletedAt }
        : dividend
    )));
    addLog('실제 입금 배당 기록을 삭제했습니다.', 'success');
  };

  return {
    isAddingDividend,
    setIsAddingDividend,
    actualDividendForm,
    setActualDividendForm,
    dividendImportInputRef,
    dividendEntryAssets,
    openActualDividendForm,
    handleActualDividendAssetChange,
    handleAddActualDividend,
    handleConfirmedDividendImport,
    removeConfirmedDividend,
  };
};
