import { Plus, X } from 'lucide-react';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters';
import FeatureInfo from './FeatureInfo';

/**
 * placeholder는 라벨이 아니다. 값을 입력하는 순간 사라져서 그 칸이 무엇이었는지
 * 알 수 없고, 스크린리더는 select와 date 입력을 이름 없는 컨트롤로 읽는다.
 * 화면에는 기존처럼 placeholder만 보이게 두고, 접근 가능한 이름을 따로 붙인다.
 */
const FIELD_CLASS = 'px-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm';

const ManualTradeEntryForm = ({ value, stockOptions, onChange, onSubmit, onClose }) => (
  // div가 아니라 form이어야 Enter로도 저장할 수 있다.
  <form
    className="p-5 md:p-6 border-b border-line bg-surface space-y-4"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
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
        aria-label="종목명"
        className={`md:col-span-2 ${FIELD_CLASS}`}
        placeholder="종목명"
        value={value.stockName}
        onChange={(event) => onChange({ ...value, stockName: event.target.value })}
      />
      <datalist id="manual-trade-stock-options">
        {stockOptions.map((name) => <option key={name} value={name} />)}
      </datalist>
      <select
        aria-label="매매 구분"
        value={value.action}
        onChange={(event) => onChange({ ...value, action: event.target.value })}
        className={FIELD_CLASS}
      >
        <option value="매수">매수</option>
        <option value="매도">매도</option>
      </select>
      <input
        type="text"
        inputMode="decimal"
        aria-label="수량"
        className={FIELD_CLASS}
        placeholder="수량"
        value={formatInputNumber(value.quantity)}
        onChange={(event) => onChange({ ...value, quantity: sanitizeNumericInput(event.target.value) })}
      />
      <input
        type="date"
        aria-label="거래일"
        className={FIELD_CLASS}
        value={value.date}
        onChange={(event) => onChange({ ...value, date: event.target.value })}
      />
      <select
        aria-label="통화"
        value={value.currency}
        onChange={(event) => onChange({ ...value, currency: event.target.value })}
        className={FIELD_CLASS}
      >
        <option value="KRW">KRW</option>
        <option value="USD">USD</option>
      </select>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <input
        type="text"
        aria-label="티커"
        className={FIELD_CLASS}
        placeholder="티커"
        value={value.ticker}
        onChange={(event) => onChange({ ...value, ticker: event.target.value.toUpperCase() })}
      />
      <input
        type="text"
        inputMode="decimal"
        aria-label="가격"
        className={FIELD_CLASS}
        placeholder="가격"
        value={formatInputNumber(value.price)}
        onChange={(event) => onChange({ ...value, price: sanitizeNumericInput(event.target.value) })}
      />
      <input
        type="text"
        inputMode="decimal"
        aria-label="실현 손익"
        className={FIELD_CLASS}
        placeholder="실현 손익"
        value={value.realizedPnl}
        onChange={(event) => onChange({ ...value, realizedPnl: event.target.value.replace(/,/g, '').replace(/[^\d.-]/g, '') })}
      />
      <textarea
        rows="2"
        aria-label="매수·매도 판단 근거 메모"
        className={`md:col-span-2 ${FIELD_CLASS} resize-none`}
        placeholder="매수·매도 판단 근거"
        value={value.memo}
        onChange={(event) => onChange({ ...value, memo: event.target.value })}
      />
    </div>

    <button type="submit" className="inline-flex items-center gap-2 px-5 py-3 bg-ink text-surface rounded-xl font-bold text-xs shadow-sm">
      <Plus size={16} /> 누락 기록 저장
    </button>
  </form>
);

export default ManualTradeEntryForm;
