import { Plus, X } from 'lucide-react';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters';
import FeatureInfo from './FeatureInfo';

const ManualTradeEntryForm = ({ value, stockOptions, onChange, onSubmit, onClose }) => (
  <div className="p-5 md:p-6 border-b border-line bg-surface space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm md:text-base font-bold text-ink">누락 매매 기록 추가</h4>
        <FeatureInfo text="원장에 없는 과거 매수·매도와 당시 메모를 함께 기록합니다." />
      </div>
      <button type="button" onClick={onClose} className="p-2 rounded-full bg-canvas text-ink-mute hover:text-ink" aria-label="누락 매매 기록 입력 닫기">
        <X size={16} />
      </button>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
      <input
        type="text"
        list="manual-trade-stock-options"
        className="md:col-span-2 px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
        placeholder="종목명"
        value={value.stockName}
        onChange={(event) => onChange({ ...value, stockName: event.target.value })}
      />
      <datalist id="manual-trade-stock-options">
        {stockOptions.map((name) => <option key={name} value={name} />)}
      </datalist>
      <select value={value.action} onChange={(event) => onChange({ ...value, action: event.target.value })} className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm">
        <option value="매수">매수</option>
        <option value="매도">매도</option>
      </select>
      <input type="text" inputMode="decimal" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="수량" value={formatInputNumber(value.quantity)} onChange={(event) => onChange({ ...value, quantity: sanitizeNumericInput(event.target.value) })} />
      <input type="date" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" value={value.date} onChange={(event) => onChange({ ...value, date: event.target.value })} />
      <select value={value.currency} onChange={(event) => onChange({ ...value, currency: event.target.value })} className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm">
        <option value="KRW">KRW</option>
        <option value="USD">USD</option>
      </select>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <input type="text" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="티커" value={value.ticker} onChange={(event) => onChange({ ...value, ticker: event.target.value.toUpperCase() })} />
      <input type="text" inputMode="decimal" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="가격" value={formatInputNumber(value.price)} onChange={(event) => onChange({ ...value, price: sanitizeNumericInput(event.target.value) })} />
      <input type="text" inputMode="decimal" className="px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm" placeholder="실현 손익" value={value.realizedPnl} onChange={(event) => onChange({ ...value, realizedPnl: event.target.value.replace(/,/g, '').replace(/[^\d.-]/g, '') })} />
      <textarea rows="2" className="md:col-span-2 px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none" placeholder="매수·매도 판단 근거" value={value.memo} onChange={(event) => onChange({ ...value, memo: event.target.value })} />
    </div>

    <button type="button" onClick={onSubmit} className="inline-flex items-center gap-2 px-5 py-3 bg-ink text-surface rounded-xl font-bold text-xs shadow-sm">
      <Plus size={16} /> 누락 기록 저장
    </button>
  </div>
);

export default ManualTradeEntryForm;
