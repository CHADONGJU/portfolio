// 매도 모달.
// 매도 단가·수량·수수료·매도일·메모를 받고, 확정 전에 차감 내역(매도 수수료,
// 증권거래세, 이번 매도분에 배분된 매수 수수료)과 차감 후 손익을 미리 보여준다.
// 실제 실현손익 계산과 원장 기록은 App의 handleSellAsset이 맡는다.
import { X } from 'lucide-react';
import ModalOverlay from '../ModalOverlay.jsx';
import BrokerFeeFields from '../BrokerFeeFields.jsx';
import { formatInputNumber, formatMoney, getCurrencySymbol, sanitizeNumericInput } from '../../utils/formatters.js';
import { formatFeeRateInput, getSellTaxRatePercent, isDomesticEtfLikeAsset } from '../../utils/tradeCosts.js';

const SellAssetModal = ({
  asset,
  sellForm,
  setSellForm,
  sellFeePreview,
  sellBuyFeeShare,
  onSell,
  onClose,
}) => {
  if (!asset) return null;

  return (
    <ModalOverlay overlayClassName="z-[120]" labelledBy="sell-asset-title" onClose={onClose}>
      <div className="bg-surface w-full max-w-110 rounded-t-3xl md:rounded-3xl p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise max-h-[88vh] overflow-y-auto scroll-soft">
        <div className="flex justify-between items-center gap-4 mb-6 md:mb-8">
          <h3 id="sell-asset-title" className="text-lg md:text-xl font-bold text-ink whitespace-nowrap">
            {asset.name} 매도
          </h3>
          <button
            onClick={onClose}
            className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="app-field-21" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매도 단가 ({getCurrencySymbol(asset.currency)})
            </label>
            <input id="app-field-21"
              type="text"
              inputMode="decimal"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
              value={formatInputNumber(sellForm.sellPrice)}
              onChange={(e) =>
                setSellForm((prev) => ({
                  ...prev,
                  sellPrice: sanitizeNumericInput(e.target.value)
                }))
              }
            />
          </div>

          <div>
            <label htmlFor="app-field-22" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매도 수량
            </label>
            <input id="app-field-22"
              type="text"
              inputMode="decimal"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
              value={formatInputNumber(sellForm.quantity)}
              onChange={(e) =>
                setSellForm((prev) => ({
                  ...prev,
                  quantity: sanitizeNumericInput(e.target.value)
                }))
              }
            />
          </div>

          <BrokerFeeFields
            idPrefix="sell"
            label="매도 수수료"
            amountOnly
            category={asset.category}
            currency={asset.currency}
            brokerId={sellForm.brokerId}
            feeRatePercent={sellForm.brokerFeeRate}
            feeAmount={sellForm.brokerFeeAmount}
            feeMode={sellForm.feeMode}
            estimatedFee={sellFeePreview?.brokerFee || 0}
            onChange={(next) => setSellForm((prev) => ({ ...prev, ...next }))}
          />

          {sellFeePreview && (sellFeePreview.grossSellAmount > 0 || sellFeePreview.grossPnl !== 0) && (
            <div className="receipt rounded-2xl px-4 py-4 md:px-5">
              <p className="eyebrow mb-3">차감 내역</p>

              <div className="space-y-2.5">
                <div className="receipt-row text-xs md:text-sm">
                  <span className="font-semibold text-ink-mute">예상 수수료</span>
                  <span className="font-bold text-ink-soft">
                    −{formatMoney(sellFeePreview.brokerFee, asset.currency)}
                  </span>
                </div>
                <div className="receipt-row text-xs md:text-sm">
                  <span className="font-semibold text-ink-mute">
                    예상 제세금
                    {isDomesticEtfLikeAsset(asset) ? ' · ETF 면제' : ''}
                  </span>
                  <span className="font-bold text-ink-soft">
                    −{formatMoney(sellFeePreview.sellTax, asset.currency)}
                  </span>
                </div>
                {sellBuyFeeShare > 0 && (
                  <div className="receipt-row text-xs md:text-sm">
                    <span className="font-semibold text-ink-mute">매수 수수료(이번 매도분)</span>
                    <span className="font-bold text-ink-soft">
                      −{formatMoney(sellBuyFeeShare, asset.currency)}
                    </span>
                  </div>
                )}
                <div className="receipt-row text-xs md:text-sm">
                  <span className="font-semibold text-ink-mute">총 차감액</span>
                  <span className="font-bold text-ink">
                    −{formatMoney(sellFeePreview.totalCost + sellBuyFeeShare, asset.currency)}
                  </span>
                </div>
              </div>

              <div className="receipt-row receipt-total">
                <span className="text-xs md:text-sm font-bold text-ink">차감 후 손익</span>
                <span className={`figure text-lg md:text-xl font-bold ${sellFeePreview.netPnl - sellBuyFeeShare >= 0 ? 'text-up' : 'text-down'}`}>
                  {sellFeePreview.netPnl - sellBuyFeeShare >= 0 ? '+' : ''}
                  {formatMoney(sellFeePreview.netPnl - sellBuyFeeShare, asset.currency)}
                </span>
              </div>

              <p className="mt-3 text-[11px] font-medium text-ink-mute leading-relaxed">
                제세금은 매도일 기준 증권거래세율로 자동 계산합니다. 국내 상장 ETF·ETN과 해외 종목은 면제라 0원으로 잡힙니다.
              </p>
            </div>
          )}

          <div className="border-t border-line pt-4 mt-2">
            <label htmlFor="app-field-26" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매도일
            </label>
            <input id="app-field-26"
              type="date"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={sellForm.sellDate}
              onChange={(e) =>
                setSellForm((prev) => ({
                  ...prev,
                  sellDate: e.target.value,
                  sellTaxRate: formatFeeRateInput(getSellTaxRatePercent(asset, e.target.value)),
                }))
              }
            />
          </div>
        </div>


          {/* 위 입력 묶음(space-y-4) 바깥이라 간격이 없었다. 같은 1rem을 직접 준다. */}
          <div className="mt-4">
            <label htmlFor="app-field-27" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매도 메모
            </label>
            <textarea id="app-field-27"
              rows="3"
              className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none"
              value={sellForm.memo}
              onChange={(e) =>
                setSellForm((prev) => ({
                  ...prev,
                  memo: e.target.value
                }))
              }
            />
          </div>
        <button
          onClick={onSell}
          className="w-full mt-7 h-13.5 bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
        >
          매도 반영하기
        </button>
      </div>
    </ModalOverlay>
  );
};

export default SellAssetModal;
