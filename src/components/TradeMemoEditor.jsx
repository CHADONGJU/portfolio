import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import FeatureInfo from './FeatureInfo';

const TradeMemoEditor = ({ record, onSave, onDelete, onClose }) => {
  const [draft, setDraft] = useState(record.memo || '');
  const savedMemo = String(record.memo || '').trim();
  const normalizedDraft = draft.trim();
  const canSave = normalizedDraft !== savedMemo && Boolean(normalizedDraft);

  return (
    <div className="rounded-2xl border border-line bg-canvas p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs md:text-sm font-bold text-ink">{record.name} 매매 메모</p>
          <FeatureInfo text={record.isUnlinkedMemo ? '거래 원장을 찾지 못한 과거 메모입니다.' : '이 메모만 수정되며 매매 기록은 변경되지 않습니다.'} />
        </div>
        <button type="button" onClick={onClose} className="p-2 rounded-full text-ink-mute hover:text-ink hover:bg-line-soft" aria-label="메모 편집 닫기">
          <X size={16} />
        </button>
      </div>
      <textarea
        rows="3"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="매수·매도 판단 근거를 입력하세요."
        className="w-full px-4 py-3 bg-surface rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink resize-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(normalizedDraft)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-surface rounded-xl font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={14} /> 저장
        </button>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs">
          <X size={14} /> 취소
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
    </div>
  );
};

export default TradeMemoEditor;
