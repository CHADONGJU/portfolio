// 새 자산 등록 모달.
// 종목 검색으로 이름·티커·현재가를 채우고, 분류·통화·수량·평단가·매수일과
// 매수 수수료를 받는다. 외화 종목은 원화로 평단가를 넣을 수 있으며, 그때는
// 매수일 환율로 현지 단가를 역산한다(App의 handleAddAsset).
import { Search, X } from 'lucide-react';
import ModalOverlay from '../ModalOverlay.jsx';
import BrokerFeeFields from '../BrokerFeeFields.jsx';
import PriceInputCurrencyToggle from '../PriceInputCurrencyToggle.jsx';
import { formatInputNumber, getCurrencySymbol, sanitizeNumericInput } from '../../utils/formatters.js';
import { PORTFOLIO_CURRENCIES } from '../../utils/currencies.js';
import { ACCOUNT_TYPE_OPTIONS, normalizeAccountType } from '../../utils/accountTypes.js';

const AddAssetModal = ({
  newAsset,
  setNewAsset,
  newAssetBuyFeePreview,
  newAssetFeeCurrency,
  resolvedCurrency,
  onAddAsset,
  onClose,
}) => (
    <ModalOverlay overlayClassName="z-[100]" labelledBy="add-asset-title" onClose={onClose}>
      <div className="bg-surface w-full max-w-110 rounded-t-3xl md:rounded-3xl p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise max-h-[88vh] overflow-y-auto scroll-soft">
        <div className="flex justify-between items-center mb-6 md:mb-8 sticky top-0 bg-surface z-10 pt-2 pb-2">
          <h3 id="add-asset-title" className="text-lg md:text-xl font-bold text-ink">새 자산 등록</h3>
          <button
            onClick={onClose}
            className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <div>
              <label htmlFor="app-field-11" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                자산 구분
              </label>
              <select id="app-field-11"
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
                value={newAsset.category}
                onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value })}
              >
                <option value="국내주식">국내주식</option>
                <option value="해외주식">해외주식</option>
              </select>
            </div>

            <div>
              <label htmlFor="app-field-12" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                통화 (Currency)
              </label>
              <select id="app-field-12"
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
                value={newAsset.currency}
                onChange={(e) => setNewAsset({ ...newAsset, currency: e.target.value })}
              >
                {PORTFOLIO_CURRENCIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
              {/* 해외주식은 티커를 보고 통화가 자동으로 정해진다.
                  여기서 원화를 골라도 달러로 저장되므로, 실제로 쓰일 통화를 분명히 알려준다. */}
              {(() => {
                if (resolvedCurrency === newAsset.currency) return null;
                return (
                  <p className="mt-1.5 ml-1 text-[11px] font-bold text-ink-mute leading-relaxed">
                    {newAsset.category}은 {getCurrencySymbol(resolvedCurrency)} {resolvedCurrency}로 저장됩니다.
                    단가는 아래에서 원화로도 입력할 수 있어요.
                  </p>
                );
              })()}
            </div>
          </div>

          <div className="relative">
            <label className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              종목명
            </label>
            <div className="relative">
              <Search size={18} className="absolute left-4 top-3.5 text-ink-mute" />
              <input
                type="text"
                className="w-full pl-11 pr-4 py-2.5 md:py-3 bg-canvas rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
                value={newAsset.name}
                onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="app-field-13" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              티커 심볼
            </label>
            <input id="app-field-13"
              type="text"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={newAsset.ticker}
              onChange={(e) => setNewAsset({ ...newAsset, ticker: e.target.value.toUpperCase() })}
            />
          </div>

          <div>
            <label htmlFor="app-field-14" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              보유 계좌
            </label>
            <select id="app-field-14"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={newAsset.accountType}
              onChange={(e) => setNewAsset({
                ...newAsset,
                accountType: normalizeAccountType(e.target.value),
              })}
            >
              {ACCOUNT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-1.5 ml-1 text-[11px] font-bold text-ink-mute leading-relaxed">
              배당은 같은 공식 분배금이라도 계좌 유형에 따라 즉시 원천징수 여부가 달라집니다.
            </p>
          </div>

          {(() => {
            // 실제로 저장될 통화. 해외주식은 사용자가 통화 칸에서 무엇을 골랐든 달러(또는 엔)로 잡힌다.
            const nativeCurrency = resolvedCurrency;
            const isForeign = nativeCurrency !== 'KRW';
            const isKrwInput = isForeign && newAsset.priceInputCurrency === 'KRW';
            const inputCurrency = isKrwInput ? 'KRW' : nativeCurrency;

            return (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5 ml-1">
                  <label className="block text-[11px] md:text-[12px] font-bold text-ink-mute">
                    평균 단가 ({getCurrencySymbol(inputCurrency)})
                  </label>
                  {isForeign && (
                    <PriceInputCurrencyToggle
                      nativeCurrency={nativeCurrency}
                      value={newAsset.priceInputCurrency}
                      onChange={(next) => setNewAsset({ ...newAsset, priceInputCurrency: next })}
                    />
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
                  value={formatInputNumber(newAsset.averagePrice)}
                  onChange={(e) =>
                    setNewAsset({
                      ...newAsset,
                      averagePrice: sanitizeNumericInput(e.target.value)
                    })
                  }
                />
              </div>
            );
          })()}

          <div>
            <label htmlFor="app-field-15" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매수 수량
            </label>
            <input id="app-field-15"
              type="text"
              inputMode="decimal"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
              value={formatInputNumber(newAsset.quantity)}
              onChange={(e) =>
                setNewAsset({
                  ...newAsset,
                  quantity: sanitizeNumericInput(e.target.value)
                })
              }
            />
          </div>

          <div className="border-t border-line pt-4 mt-2">
            <div>
              <label htmlFor="app-field-16" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                매수일
              </label>
              <input id="app-field-16"
                type="date"
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                value={newAsset.buyDate}
                onChange={(e) => setNewAsset({ ...newAsset, buyDate: e.target.value })}
              />
            </div>

            <div className="mt-4">
              <BrokerFeeFields
                idPrefix="add-asset"
                label="매수 수수료"
                amountOnly
                category={newAsset.category}
                currency={newAssetFeeCurrency}
                brokerId={newAsset.brokerId}
                feeRatePercent={newAsset.brokerFeeRate}
                feeAmount={newAsset.brokerFeeAmount}
                feeMode={newAsset.feeMode}
                estimatedFee={newAssetBuyFeePreview}
                onChange={(next) => setNewAsset((prev) => ({ ...prev, ...next }))}
              />
            </div>

          </div>


          {/* 위 입력 묶음(space-y-4) 바깥이라 간격이 없었다. 같은 1rem을 직접 준다. */}
          <div className="mt-4">
            <label htmlFor="app-field-17" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매수 메모
            </label>
            <textarea id="app-field-17"
              rows="3"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none"
              value={newAsset.memo}
              onChange={(e) => setNewAsset({ ...newAsset, memo: e.target.value })}
            />
          </div>
          <button
            onClick={onAddAsset}
            className="w-full mt-7 h-13.5 bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
          >
            포트폴리오에 반영하기
          </button>
        </div>
      </div>
    </ModalOverlay>
);

export default AddAssetModal;
