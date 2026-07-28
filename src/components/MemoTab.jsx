import { useState } from 'react';
import { CalendarDays, Check, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters';

const normalizeAction = (memo) => {
  if (memo.side === 'buy' || memo.type === 'buy') return '매수';
  if (memo.side === 'sell' || memo.type === 'sell') return '매도';
  if (memo.action === '매수' || memo.action === '매도') return memo.action;
  if (memo.sellDate || Number(memo.pnl || 0) !== 0) return '매도';
  return '매수';
};

const MemoItem = ({ memo, onRemoveMemo, onUpdateMemo, formatMoney }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(memo.memo || '');
  const action = normalizeAction(memo);
  const actionTone = action === '매수' ? 'bg-up-soft text-up' : 'bg-down-soft text-down';
  const pnl = Number(memo.pnl || 0);
  const isSell = action === '매도';

  const handleSave = () => {
    onUpdateMemo(memo.id, draft);
    setIsEditing(false);
  };

  return (
    <article className="p-4 md:p-5 hover:bg-canvas/60 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex px-2.5 py-1 rounded-lg text-[12px] font-bold ${actionTone}`}>
              {action}
            </span>
            <h4 className="font-bold text-ink text-sm md:text-base truncate">{memo.name}</h4>
            {memo.ticker && <span className="text-[12px] font-bold text-ink-mute">{memo.ticker}</span>}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[12px] md:text-xs font-bold text-ink-soft">
            <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {memo.date}</span>
            <span>{Number(memo.quantity || 0).toLocaleString()}주</span>
            <span>단가 {formatMoney(memo.price, memo.currency)}</span>
            {isSell && memo.pnlSource === 'unavailable' ? (
              <span className="text-ink-mute">손익 계산 불가</span>
            ) : isSell && (
              <span className={pnl >= 0 ? 'text-up' : 'text-down'}>
                손익 {pnl > 0 ? '+' : ''}{formatMoney(pnl, memo.currency)}
              </span>
            )}
          </div>

          <div className="mt-3">
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  rows="3"
                  className="w-full px-4 py-3 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-sm resize-none"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="매수/매도 근거를 입력하세요."
                />
                <div className="flex gap-2">
                  <button onClick={handleSave} className="inline-flex items-center gap-1.5 px-3 py-2 bg-ink text-surface rounded-xl font-bold text-xs">
                    <Check size={14} /> 저장
                  </button>
                  <button
                    onClick={() => {
                      setDraft(memo.memo || '');
                      setIsEditing(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-line-soft text-ink-soft rounded-xl font-bold text-xs"
                  >
                    <X size={14} /> 취소
                  </button>
                </div>
              </div>
            ) : (
              <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${memo.memo ? 'text-ink-soft font-bold' : 'text-ink-mute font-semibold'}`}>
                {memo.memo || '메모 없음'}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="p-2 text-ink-mute hover:text-ink hover:bg-line-soft rounded-xl transition-colors"
              title="메모 수정"
            >
              <Pencil size={15} />
            </button>
          )}
          <button
            onClick={(e) => onRemoveMemo(memo.id, e)}
            className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
            title="메모 삭제"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
};

const MemoTab = ({
  memos,
  stockOptions,
  stockFilter,
  onStockFilterChange,
  sortMode,
  onSortModeChange,
  sortOptions,
  summary,
  manualMemo,
  onManualMemoChange,
  onAddManualMemo,
  onRemoveMemo,
  onUpdateMemo,
  formatMoney,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);

  return (
    <div className="space-y-6 anim-fade">
      <div className="bg-surface rounded-[20px] overflow-hidden">
        <div className="p-5 md:p-7 border-b border-line flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-surface">
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink flex items-center gap-2">
              <NotebookPen className="text-ink-soft" size={20} /> 메모장
            </h3>
            <p className="text-[12px] md:text-xs font-bold text-ink-mute mt-1">
              매수와 매도의 판단 근거를 종목별로 정리합니다.
            </p>
          </div>
          <button
            onClick={() => setIsFormOpen((value) => !value)}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-ink text-surface rounded-xl font-bold text-xs shadow-sm hover:bg-ink transition-colors"
          >
            {isFormOpen ? <X size={16} /> : <Plus size={16} />}
            {isFormOpen ? '입력 닫기' : '메모 추가'}
          </button>
        </div>

        <div className="p-5 md:p-6 border-b border-line grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-canvas rounded-xl p-4">
            <p className="text-[12px] font-bold text-ink-mute mb-1">총 매수 횟수</p>
            <p className="text-lg font-bold text-ink">{summary.totalBuyCount.toLocaleString()}회</p>
          </div>
          <div className="bg-canvas rounded-xl p-4">
            <p className="text-[12px] font-bold text-ink-mute mb-1">총 매도 횟수</p>
            <p className="text-lg font-bold text-ink">{summary.totalSellCount.toLocaleString()}회</p>
          </div>
          <div className="bg-canvas rounded-xl p-4">
            <p className="text-[12px] font-bold text-ink-mute mb-1">총 실현 손익</p>
            <p className={`text-lg font-bold ${summary.totalProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {summary.totalProfit > 0 ? '+' : ''}{formatMoney(summary.totalProfit, 'KRW')}
            </p>
          </div>
        </div>

        {isFormOpen && (
          <div className="p-5 md:p-6 border-b border-line bg-surface space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <input
                type="text"
                list="memo-stock-options"
                className="md:col-span-2 px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
                placeholder="주식명"
                value={manualMemo.stockName}
                onChange={(e) => onManualMemoChange({ ...manualMemo, stockName: e.target.value })}
              />
              <datalist id="memo-stock-options">
                {stockOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
              <select value={manualMemo.action} onChange={(e) => onManualMemoChange({ ...manualMemo, action: e.target.value })} className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm">
                <option value="매수">매수</option>
                <option value="매도">매도</option>
              </select>
              <input type="text" inputMode="decimal" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="수량" value={formatInputNumber(manualMemo.quantity)} onChange={(e) => onManualMemoChange({ ...manualMemo, quantity: sanitizeNumericInput(e.target.value) })} />
              <input type="date" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" value={manualMemo.date} onChange={(e) => onManualMemoChange({ ...manualMemo, date: e.target.value })} />
              <select value={manualMemo.currency} onChange={(e) => onManualMemoChange({ ...manualMemo, currency: e.target.value })} className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm">
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input type="text" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="티커" value={manualMemo.ticker} onChange={(e) => onManualMemoChange({ ...manualMemo, ticker: e.target.value.toUpperCase() })} />
              <input type="text" inputMode="decimal" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="가격" value={formatInputNumber(manualMemo.price)} onChange={(e) => onManualMemoChange({ ...manualMemo, price: sanitizeNumericInput(e.target.value) })} />
              <input type="text" inputMode="decimal" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="실현 손익" value={manualMemo.realizedPnl} onChange={(e) => onManualMemoChange({ ...manualMemo, realizedPnl: e.target.value.replace(/,/g, '').replace(/[^\d.-]/g, '') })} />
              <textarea rows="2" className="md:col-span-2 px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none" placeholder="매수/매도 근거" value={manualMemo.memo} onChange={(e) => onManualMemoChange({ ...manualMemo, memo: e.target.value })} />
            </div>

            <button onClick={onAddManualMemo} className="inline-flex items-center gap-2 px-5 py-3 bg-ink text-surface rounded-xl font-bold text-xs shadow-sm hover:bg-ink transition-colors">
              <Plus size={16} /> 저장
            </button>
          </div>
        )}

        <div className="p-5 md:p-6 border-b border-line bg-surface">
          <div className="flex flex-col md:flex-row gap-3">
            <select value={stockFilter} onChange={(e) => onStockFilterChange(e.target.value)} className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft">
              <option value="all">전체 종목</option>
              {stockOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select value={sortMode} onChange={(e) => onSortModeChange(e.target.value)} className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft">
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {memos.length > 0 ? (
          <div className="divide-y divide-line">
            {memos.map((memo) => (
              <MemoItem key={memo.id} memo={memo} onRemoveMemo={onRemoveMemo} onUpdateMemo={onUpdateMemo} formatMoney={formatMoney} />
            ))}
          </div>
        ) : (
          <div className="p-10 md:p-14 text-center">
            <NotebookPen className="mx-auto mb-4 text-ink-mute" size={34} />
            <p className="text-ink-mute font-bold text-sm">표시할 매수/매도 메모가 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemoTab;
