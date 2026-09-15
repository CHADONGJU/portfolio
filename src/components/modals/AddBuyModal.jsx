// 추가 매수 모달.
// 이미 보유 중인 종목에 매수를 더한다. 외화 종목은 원화로 단가를 넣을 수 있고,
// 그때는 매수일 환율로 현지 단가를 역산한다(App의 handleAddBuyToAsset).
// 평단가 재계산과 원장 기록도 App이 맡고, 여기서는 입력만 받는다.
import { X } from 'lucide-react';
import ModalOverlay from '../ModalOverlay.jsx';
import BrokerFeeFields from '../BrokerFeeFields.jsx';
import PriceInputCurrencyToggle from '../PriceInputCurrencyToggle.jsx';
import { formatInputNumber, getCurrencySymbol, sanitizeNumericInput } from '../../utils/formatters.js';
import { formatNameWithAccount } from '../../utils/accountTypes.js';

const AddBuyModal = ({
  asset,
  addBuyForm,
  setAddBuyForm,
  addBuyFeePreview,
  addBuyFeeCurrency,
  onAddBuy,
  onClose,
}) => {
  if (!asset) return null;

  return (
    <ModalOverlay overlayClassName="z-[110]" labelledBy="update-asset-title" onClose={onClose}>
      <div className="bg-surface w-full max-w-110 rounded-t-3xl md:rounded-3xl p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise max-h-[88vh] overflow-y-auto scroll-soft">
        <div className="flex justify-between items-center mb-6 md:mb-8">
          <h3 id="update-asset-title" className="text-lg md:text-xl font-bold text-ink">
            {formatNameWithAccount(asset.name, asset.accountName)} 추가 매수
          </h3>
          <button
            onClick={onClose}
            className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {(() => {
            const nativeCurrency = asset.currency || 'KRW';
            const isForeign = nativeCurrency !== 'KRW';
            const isKrwInput = isForeign && addBuyForm.priceInputCurrency === 'KRW';
            const inputCurrency = isKrwInput ? 'KRW' : nativeCurrency;

            return (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5 ml-1">
                  <label className="block text-[11px] md:text-[12px] font-bold text-ink-mute">
                    추가 매수 단가 ({getCurrencySymbol(inputCurrency)})
                  </label>
                  {isForeign && (
                    <PriceInputCurrencyToggle
                      nativeCurrency={nativeCurrency}
                      value={addBuyForm.priceInputCurrency}
                      onChange={(next) => setAddBuyForm((prev) => ({ ...prev, priceInputCurrency: next }))}
                    />
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
                  value={formatInputNumber(addBuyForm.averagePrice)}
                  onChange={(e) =>
                    setAddBuyForm((prev) => ({
                      ...prev,
                      averagePrice: sanitizeNumericInput(e.target.value)
                    }))
                  }
                />
              </div>
            );
          })()}

          <div>
            <label htmlFor="app-field-18" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              추가 매수 수량
            </label>
            <input id="app-field-18"
              type="text"
              inputMode="decimal"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
              value={formatInputNumber(addBuyForm.quantity)}
              onChange={(e) =>
                setAddBuyForm((prev) => ({
                  ...prev,
                  quantity: sanitizeNumericInput(e.target.value)
                }))
              }
            />
          </div>

          <div className="border-t border-line pt-4 mt-2">
            <label htmlFor="app-field-19" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              추가 매수일
            </label>
            <input id="app-field-19"
              type="date"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={addBuyForm.buyDate}
              onChange={(e) =>
                setAddBuyForm((prev) => ({
                  ...prev,
                  buyDate: e.target.value
                }))
              }
            />

            <div className="mt-4">
              <BrokerFeeFields
                idPrefix="add-buy"
                label="매수 수수료"
                amountOnly
                category={asset.category}
                currency={addBuyFeeCurrency}
                brokerId={addBuyForm.brokerId}
                feeRatePercent={addBuyForm.brokerFeeRate}
                feeAmount={addBuyForm.brokerFeeAmount}
                feeMode={addBuyForm.feeMode}
                estimatedFee={addBuyFeePreview}
                onChange={(next) => setAddBuyForm((prev) => ({ ...prev, ...next }))}
              />
            </div>
          </div>
        </div>


          {/* 위 입력 묶음(space-y-4) 바깥이라 간격이 없었다. 같은 1rem을 직접 준다. */}
          <div className="mt-4">
            <label htmlFor="app-field-20" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매수 메모
            </label>
            <textarea id="app-field-20"
              rows="3"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none"
              value={addBuyForm.memo}
              onChange={(e) =>
                setAddBuyForm((prev) => ({
                  ...prev,
                  memo: e.target.value
                }))
              }
            />
          </div>
        <button
          onClick={onAddBuy}
          className="w-full mt-7 h-13.5 bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
        >
          추가 매수 반영하기
        </button>
      </div>
    </ModalOverlay>
  );
};

export default AddBuyModal;
