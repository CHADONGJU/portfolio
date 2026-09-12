// 매수 내역 편집기.
// 한 종목의 매수 건들을 표로 펼쳐 수량·단가·날짜·수수료를 직접 고친다.
// 증권사 화면과 평단가가 맞지 않을 때 사용자가 직접 맞출 수 있는 통로다.
import { Plus, Trash2, X } from 'lucide-react';
import { ACCOUNT_TYPE_OPTIONS, normalizeAccountType } from '../utils/accountTypes';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from '../utils/formatters';
import { parseTradeNumber as parseNumber } from '../utils/tradeReconciliation';

export default function BuyLotsEditor({ asset, drafts, summary, accountType, onAccountTypeChange, onClose, onUpdate, onRemove, onAdd, onSave }) {
  return (
    <div className="bg-surface w-full max-w-4xl h-[92dvh] md:h-auto md:max-h-[92dvh] rounded-t-[24px] md:rounded-[24px] shadow-modal anim-rise flex flex-col overflow-hidden">
      <div className="flex justify-between items-start gap-4 px-6 pt-6 md:px-7 md:pt-7 mb-5 md:mb-6 shrink-0">
        <div className="min-w-0">
          <h3 id="manage-buys-title" className="text-lg md:text-xl font-bold text-ink truncate">
            {asset.name} 매수 기록
          </h3>
          <p className="text-[12px] md:text-xs text-ink-mute font-bold mt-1 truncate">
            {asset.ticker || '-'} · {drafts.length.toLocaleString()}개 기록
          </p>
        </div>
        <button
          aria-label="매수 기록 닫기"
          onClick={onClose}
          className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-3 px-6 md:px-7 mb-4 md:mb-5 shrink-0">
        <div className="rounded-xl bg-canvas px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[11px] md:text-[11px] font-bold text-ink-mute">총 매수수량</p>
          <p className="mt-1 text-sm md:text-base font-bold text-ink">
            {summary.totalQuantity.toLocaleString()}주
          </p>
        </div>
        <div className="rounded-xl bg-canvas px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[11px] md:text-[11px] font-bold text-ink-mute">평단</p>
          <p className="mt-1 text-sm md:text-base font-bold text-ink">
            {formatMoney(summary.averagePrice, asset.currency)}
          </p>
        </div>
        <div className="rounded-xl bg-canvas px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[11px] md:text-[11px] font-bold text-ink-mute">최초 매수일</p>
          <p className="mt-1 text-sm md:text-base font-bold text-ink">
            {drafts.map(lot => lot.date).filter(Boolean).sort()[0] || '-'}
          </p>
          {summary.totalBuyFee > 0 && (
            <p className="text-[11px] font-bold text-ink-mute mt-1">
              매수 수수료 {formatMoney(summary.totalBuyFee, asset.currency)}
            </p>
          )}
        </div>
      </div>

      <div className="mx-6 md:mx-7 hairline rounded-xl bg-canvas px-3 py-3 md:px-4 md:py-3.5 mb-4 md:mb-5 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div>
            <label htmlFor="buy-lots-account-type" className="block text-[11px] font-bold text-ink-mute mb-1">보유 계좌</label>
            <p id="buy-lots-account-type-hint" className="text-[11px] md:text-[12px] font-bold text-ink-mute leading-relaxed">
              ISA·연금계좌는 국내 상장 ETF 분배금의 즉시 원천징수를 유예합니다.
            </p>
          </div>
          <select
            id="buy-lots-account-type"
            aria-describedby="buy-lots-account-type-hint"
            className="w-full sm:w-40 px-3 h-11 bg-surface rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
            value={accountType}
            onChange={(event) => onAccountTypeChange(normalizeAccountType(event.target.value))}
          >
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-soft px-6 md:px-7 pb-4">
        <div className="hidden md:grid grid-cols-[1.05fr_1fr_1fr_0.7fr_1fr_44px] gap-3 px-2 pb-2 text-[11px] font-bold text-ink-mute">
          <span>매수일</span>
          <span className="text-right">단가</span>
          <span className="text-right">수량</span>
          <span className="text-right">수수료</span>
          <span className="text-right">매수금액</span>
          <span></span>
        </div>
        <div className="space-y-3">
          {drafts.map((lot, index) => {
            const lotQuantity = parseNumber(lot.quantity);
            const lotPrice = parseNumber(lot.price);
            const lotAmount = lotQuantity * lotPrice;

            return (
              <div key={lot.draftId} className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr_1fr_0.7fr_1fr_44px] gap-2 md:gap-3 items-end rounded-xl bg-canvas bg-canvas/70 p-3">
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-date`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">매수일</label>
                  <input
                    id={`buy-lot-${lot.draftId}-date`}
                    aria-label={`${index + 1}번째 매수 기록의 매수일`}
                    type="date"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                    value={lot.date}
                    onChange={(e) => onUpdate(lot.draftId, 'date', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-price`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">단가</label>
                  <input
                    id={`buy-lot-${lot.draftId}-price`}
                    aria-label={`${index + 1}번째 매수 기록의 단가`}
                    type="text"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.price)}
                    onChange={(e) => onUpdate(lot.draftId, 'price', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-quantity`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">수량</label>
                  <input
                    id={`buy-lot-${lot.draftId}-quantity`}
                    aria-label={`${index + 1}번째 매수 기록의 수량`}
                    type="text"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.quantity)}
                    onChange={(e) => onUpdate(lot.draftId, 'quantity', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-fee`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">매수 수수료</label>
                  <input
                    id={`buy-lot-${lot.draftId}-fee`}
                    aria-label={`${index + 1}번째 매수 기록의 매수 수수료`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.brokerFee ?? '')}
                    onChange={(e) => onUpdate(lot.draftId, 'brokerFee', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-canvas text-right">
                  <p className="md:hidden text-[11px] font-bold text-ink-mute mb-1">매수금액</p>
                  <p className="font-bold text-ink text-xs md:text-sm">
                    {formatMoney(lotAmount, asset.currency)}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(lot.draftId)}
                  disabled={drafts.length <= 1}
                  className="h-10 md:h-11 inline-flex items-center justify-center rounded-xl text-ink-mute hover:text-danger hover:bg-danger-soft disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-mute transition-colors"
                  title={`${index + 1}번째 매수 기록 삭제`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:gap-3 px-6 md:px-7 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-7 border-t border-line-soft bg-surface shrink-0">
        <button
          onClick={onAdd}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-line-soft hover:bg-line text-ink-soft rounded-xl font-bold text-xs md:text-sm transition-colors"
        >
          <Plus size={16} /> 매수 기록 추가
        </button>
        <button
          onClick={onSave}
          className="flex-1 h-12 px-6 bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
        >
          매수 기록 저장하기
        </button>
      </div>
    </div>
  );
}
