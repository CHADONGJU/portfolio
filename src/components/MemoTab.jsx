import { useState } from 'react';
import { NotebookPen, Plus, Trash2 } from 'lucide-react';
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

  const handleSave = () => {
    onUpdateMemo(memo.id, draft);
    setIsEditing(false);
  };

  return (
    <div className="p-5 md:p-7 hover:bg-slate-50/60 transition-colors">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`inline-flex px-3 py-1 rounded-xl text-[10px] font-black ${action === '매수' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
              {action}
            </span>
            <h4 className="font-black text-slate-900 text-sm md:text-base">{memo.name}</h4>
            {memo.ticker && <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{memo.ticker}</span>}
          </div>

          <div className="flex flex-wrap gap-2 text-[10px] md:text-xs font-bold text-slate-500 mb-3">
            <span className="bg-slate-100 px-3 py-1.5 rounded-xl">수량 {Number(memo.quantity).toLocaleString()}</span>
            <span className="bg-slate-100 px-3 py-1.5 rounded-xl">일자 {memo.date}</span>
            <span className="bg-slate-100 px-3 py-1.5 rounded-xl">가격 {formatMoney(memo.price, memo.currency)}</span>
            {Number(memo.pnl || 0) !== 0 && (
              <span className={`px-3 py-1.5 rounded-xl ${Number(memo.pnl) >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                손익 {Number(memo.pnl) > 0 ? '+' : ''}{formatMoney(memo.pnl, memo.currency)}
              </span>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-3">
              <textarea
                rows="3"
                className="w-full px-4 py-3 bg-white border border-blue-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-sm resize-none"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="매수/매도 근거를 입력하세요."
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl font-black text-xs"
                >
                  저장
                </button>
                <button
                  onClick={() => {
                    setDraft(memo.memo || '');
                    setIsEditing(false);
                  }}
                  className="px-4 py-2 bg-slate-100 text-slate-500 rounded-xl font-black text-xs"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm md:text-base text-slate-700 font-bold leading-relaxed whitespace-pre-wrap break-words">
                {memo.memo || '작성된 메모가 없습니다.'}
              </p>
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl font-black text-xs hover:bg-blue-100 transition-colors"
              >
                메모 수정
              </button>
            </div>
          )}
        </div>

        <button
          onClick={(e) => onRemoveMemo(memo.id, e)}
          className="self-start text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors p-2 rounded-xl"
          title="메모 삭제"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
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
}) => (
  <div className="space-y-6 animate-in fade-in duration-500">
    <div className="bg-white rounded-[30px] md:rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 md:p-8 border-b border-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-slate-50/30">
        <h3 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
          <NotebookPen className="text-blue-600" size={20} /> 메모장
        </h3>
        <span className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">
          매수/매도 근거 {memos.length.toLocaleString()}건
        </span>
      </div>

      <div className="p-5 md:p-6 border-b border-slate-50 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            type="text"
            list="memo-stock-options"
            className="md:col-span-2 px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
            placeholder="주식명"
            value={manualMemo.stockName}
            onChange={(e) => onManualMemoChange({ ...manualMemo, stockName: e.target.value })}
          />
          <datalist id="memo-stock-options">
            {stockOptions.map((name) => <option key={name} value={name} />)}
          </datalist>
          <select
            value={manualMemo.action}
            onChange={(e) => onManualMemoChange({ ...manualMemo, action: e.target.value })}
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
          >
            <option value="매수">매수</option>
            <option value="매도">매도</option>
          </select>
          <input
            type="text"
            inputMode="decimal"
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
            placeholder="수량"
            value={formatInputNumber(manualMemo.quantity)}
            onChange={(e) => onManualMemoChange({ ...manualMemo, quantity: sanitizeNumericInput(e.target.value) })}
          />
          <input
            type="date"
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
            value={manualMemo.date}
            onChange={(e) => onManualMemoChange({ ...manualMemo, date: e.target.value })}
          />
          <select
            value={manualMemo.currency}
            onChange={(e) => onManualMemoChange({ ...manualMemo, currency: e.target.value })}
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
          >
            <option value="KRW">KRW</option>
            <option value="USD">USD</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
            placeholder="티커"
            value={manualMemo.ticker}
            onChange={(e) => onManualMemoChange({ ...manualMemo, ticker: e.target.value.toUpperCase() })}
          />
          <input
            type="text"
            inputMode="decimal"
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
            placeholder="가격"
            value={formatInputNumber(manualMemo.price)}
            onChange={(e) => onManualMemoChange({ ...manualMemo, price: sanitizeNumericInput(e.target.value) })}
          />
          <input
            type="text"
            inputMode="decimal"
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
            placeholder="실현 손익"
            value={manualMemo.realizedPnl}
            onChange={(e) => onManualMemoChange({ ...manualMemo, realizedPnl: e.target.value.replace(/,/g, '').replace(/[^\d.-]/g, '') })}
          />
          <textarea
            rows="2"
            className="md:col-span-2 px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm resize-none"
            placeholder="나중에 남기는 매수/매도 근거"
            value={manualMemo.memo}
            onChange={(e) => onManualMemoChange({ ...manualMemo, memo: e.target.value })}
          />
        </div>

        <button
          onClick={onAddManualMemo}
          className="inline-flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs shadow-xl shadow-slate-200 hover:scale-[1.02] transition-all"
        >
          <Plus size={16} /> 메모 추가
        </button>
      </div>

      <div className="p-5 md:p-6 border-b border-slate-50 bg-white space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <select
            value={stockFilter}
            onChange={(e) => onStockFilterChange(e.target.value)}
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-slate-700"
          >
            <option value="all">전체 종목</option>
            {stockOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select
            value={sortMode}
            onChange={(e) => onSortModeChange(e.target.value)}
            className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-slate-700"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총 매수 수량</p>
            <p className="text-lg font-black text-slate-800">{summary.totalBuyQuantity.toLocaleString()}</p>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총 매도 수량</p>
            <p className="text-lg font-black text-slate-800">{summary.totalSellQuantity.toLocaleString()}</p>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총 수익</p>
            <p className={`text-lg font-black ${summary.totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {summary.totalProfit > 0 ? '+' : ''}{formatMoney(summary.totalProfit, 'KRW')}
            </p>
          </div>
        </div>
      </div>

      {memos.length > 0 ? (
        <div className="divide-y divide-slate-50">
          {memos.map((memo) => (
            <MemoItem
              key={memo.id}
              memo={memo}
              onRemoveMemo={onRemoveMemo}
              onUpdateMemo={onUpdateMemo}
              formatMoney={formatMoney}
            />
          ))}
        </div>
      ) : (
        <div className="p-10 md:p-14 text-center">
          <NotebookPen className="mx-auto mb-4 text-slate-300" size={34} />
          <p className="text-slate-400 font-bold text-sm">표시할 매수/매도 메모가 없습니다.</p>
        </div>
      )}
    </div>
  </div>
);

export default MemoTab;
