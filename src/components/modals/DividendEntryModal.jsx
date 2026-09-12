// 실제 입금 배당 추가 모달.
// 증권사 계좌에 실제로 들어온 배당을 직접 기록한다. 공식에서 계산한 예상 배당과
// 달리 이 기록은 "확정 수령"으로 취급되어 배당 합계와 연간 수익률에 그대로 반영된다.
// 보유 종목을 고르면 이름·티커·통화가 자동으로 채워지고, 목록에 없는 과거 종목은
// 직접 입력할 수 있다.
import { X } from 'lucide-react';
import ModalOverlay from '../ModalOverlay.jsx';
import FeatureInfo from '../FeatureInfo.jsx';
import { PORTFOLIO_CURRENCIES } from '../../utils/currencies.js';
import { formatInputNumber, sanitizeNumericInput } from '../../utils/formatters.js';

const DividendEntryModal = ({
  actualDividendForm,
  setActualDividendForm,
  dividendEntryAssets,
  onAssetChange,
  onAdd,
  onClose,
}) => (
    <ModalOverlay overlayClassName="z-[110]" labelledBy="dividend-entry-title" onClose={onClose}>
      <div className="bg-surface w-full max-w-110 max-h-[90vh] overflow-y-auto scroll-soft rounded-t-3xl md:rounded-3xl p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <h3 id="dividend-entry-title" className="text-lg md:text-xl font-bold text-ink">실제 입금 배당 추가</h3>
            <FeatureInfo text="증권사에 들어온 세후 금액을 그대로 입력합니다." align="right" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="app-field-4" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">종목</label>
            <select id="app-field-4"
              value={actualDividendForm.assetId}
              onChange={(event) => onAssetChange(event.target.value)}
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
            >
              <option value="">종목 선택</option>
              {dividendEntryAssets.map((asset) => (
                <option key={asset.id} value={String(asset.id)}>{asset.name} · {asset.ticker || asset.currency}</option>
              ))}
              <option value="__manual__">목록에 없는 종목 직접 입력</option>
            </select>
          </div>

          {actualDividendForm.assetId === '__manual__' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="app-field-5" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">종목명</label>
                <input id="app-field-5"
                  value={actualDividendForm.name}
                  onChange={(event) => setActualDividendForm((previous) => ({ ...previous, name: event.target.value }))}
                  placeholder="예: QUALCOMM"
                  className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                />
              </div>
              <div>
                <label htmlFor="app-field-6" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">티커</label>
                <input id="app-field-6"
                  value={actualDividendForm.ticker}
                  onChange={(event) => setActualDividendForm((previous) => ({ ...previous, ticker: event.target.value.toUpperCase() }))}
                  placeholder="예: QCOM"
                  className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink uppercase"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="app-field-7" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">입금일</label>
              <input id="app-field-7"
                type="date"
                value={actualDividendForm.date}
                onChange={(event) => setActualDividendForm((previous) => ({ ...previous, date: event.target.value }))}
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="app-field-8" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">통화</label>
              <select id="app-field-8"
                value={actualDividendForm.currency}
                onChange={(event) => setActualDividendForm((previous) => ({
                  ...previous,
                  currency: event.target.value,
                  category: previous.assetId === '__manual__'
                    ? (event.target.value === 'KRW' ? '국내주식' : '해외주식')
                    : previous.category,
                }))}
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              >
                {PORTFOLIO_CURRENCIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="app-field-9" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">실제 입금액</label>
              <input id="app-field-9"
                inputMode="decimal"
                value={formatInputNumber(actualDividendForm.amount)}
                onChange={(event) => setActualDividendForm((previous) => ({ ...previous, amount: sanitizeNumericInput(event.target.value) }))}
                placeholder="0"
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="app-field-10" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">기준 수량</label>
              <input id="app-field-10"
                inputMode="decimal"
                value={formatInputNumber(actualDividendForm.quantity)}
                onChange={(event) => setActualDividendForm((previous) => ({ ...previous, quantity: sanitizeNumericInput(event.target.value) }))}
                placeholder="선택"
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-13 bg-line-soft text-ink-soft rounded-2xl font-bold text-sm hover:bg-line transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onAdd}
              className="h-13 bg-brand text-white rounded-2xl font-bold text-sm hover:opacity-90 transition-opacity"
            >
              실제 입금 반영
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
);

export default DividendEntryModal;
