import { useId, useState } from 'react';
import { Check, Eraser, Trash2, X } from 'lucide-react';
import FeatureInfo from './FeatureInfo';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters';
import { getEditableTradeFields } from '../utils/tradeRecordEditing';

const CURRENCY_SYMBOLS = { USD: '$', JPY: '¥', KRW: '₩' };
const FIELD_CLASS = 'w-full px-4 h-[48px] bg-surface rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink';
const LABEL_CLASS = 'block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1';

const getInfoText = (record, side) => {
  if (record.isUnlinkedMemo) return '거래 원장을 찾지 못한 과거 메모입니다. 고친 값은 이 메모 기록에만 반영됩니다.';
  if (side === 'sell') return '매도가·수수료를 고치면 실현 손익이 그 차이만큼 다시 계산됩니다. 수수료는 증권사 화면에 찍힌 금액을 넣으세요.';
  return '매수일·매수가를 고치면 보유 평단과 최초 매수일이 다시 계산됩니다. 수수료는 증권사 화면에 찍힌 금액을 넣으세요.';
};

/**
 * 과거 매매 한 건의 거래일·단가·수수료·메모 수정.
 * 저장이 실패하면(환율 조회 실패 등) 입력을 그대로 두고, 성공하면 부모가 편집기를 닫는다.
 */
const TradeRecordEditor = ({ record, onSave, onDelete, onClose }) => {
  const idPrefix = useId();
  const initial = getEditableTradeFields(record);
  const [dateDraft, setDateDraft] = useState(initial.date);
  const [priceDraft, setPriceDraft] = useState(initial.price > 0 ? String(initial.price) : '');
  const [feeDraft, setFeeDraft] = useState(String(initial.brokerFee));
  const [memoDraft, setMemoDraft] = useState(record.memo || '');
  const [isSaving, setIsSaving] = useState(false);

  const action = initial.side === 'sell' ? '매도' : '매수';
  const currency = String(record.currency || 'KRW').toUpperCase();
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;
  const savedMemo = String(record.memo || '').trim();
  const normalizedMemo = memoDraft.trim();
  const tradeChanged = dateDraft !== initial.date
    || Math.abs((Number(priceDraft) || 0) - initial.price) > 1e-9
    || Math.abs((Number(feeDraft) || 0) - initial.brokerFee) > 1e-9;
  const memoChanged = normalizedMemo !== savedMemo;
  // 미연결 기록은 메모가 곧 기록이라 비운 채 저장하지 않는다(삭제 버튼이 따로 있다).
  const blocksEmptyMemo = record.isUnlinkedMemo && !normalizedMemo;
  const canSave = !isSaving && (tradeChanged || memoChanged) && !blocksEmptyMemo;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    const saved = await onSave({ date: dateDraft, price: priceDraft, brokerFee: feeDraft, memo: normalizedMemo });
    if (!saved) setIsSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-canvas p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs md:text-sm font-bold text-ink">{record.name} {action} 기록 수정</p>
          <FeatureInfo text={getInfoText(record, initial.side)} />
        </div>
        <button type="button" onClick={onClose} className="p-2 rounded-full text-ink-mute hover:text-ink hover:bg-line-soft" aria-label="기록 편집 닫기">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label htmlFor={`${idPrefix}-date`} className={LABEL_CLASS}>{action}일</label>
          <input
            id={`${idPrefix}-date`}
            type="date"
            value={dateDraft}
            onChange={(event) => setDateDraft(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-price`} className={LABEL_CLASS}>
            {action}가 ({currencySymbol}) · {Number(record.quantity || 0).toLocaleString()}주
          </label>
          <input
            id={`${idPrefix}-price`}
            type="text"
            inputMode="decimal"
            value={formatInputNumber(priceDraft)}
            onChange={(event) => setPriceDraft(sanitizeNumericInput(event.target.value))}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-fee`} className={LABEL_CLASS}>{action} 수수료 ({currencySymbol})</label>
          <input
            id={`${idPrefix}-fee`}
            type="text"
            inputMode="decimal"
            value={formatInputNumber(feeDraft)}
            onChange={(event) => setFeeDraft(sanitizeNumericInput(event.target.value))}
            placeholder="0"
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <label htmlFor={`${idPrefix}-memo`} className={LABEL_CLASS}>메모</label>
      <textarea
        id={`${idPrefix}-memo`}
        rows="3"
        value={memoDraft}
        onChange={(event) => setMemoDraft(event.target.value)}
        placeholder="매수·매도 판단 근거를 입력하세요."
        className="w-full px-4 py-3 bg-surface rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink resize-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-surface rounded-xl font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={14} /> {isSaving ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs">
          <X size={14} /> 취소
        </button>
        <button
          type="button"
          disabled={memoDraft.length === 0}
          onClick={() => setMemoDraft('')}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Eraser size={14} /> 메모 지우기
        </button>
        {record.memoRecordId !== null && record.memoRecordId !== undefined && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 ml-auto bg-danger-soft text-danger rounded-xl font-bold text-xs"
          >
            <Trash2 size={14} /> 메모만 삭제
          </button>
        )}
      </div>
    </form>
  );
};

export default TradeRecordEditor;
