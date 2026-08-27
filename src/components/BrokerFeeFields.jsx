import {
  BROKER_FEE_PRESETS,
  formatFeeRateInput,
  getBrokerFeeRatePercent,
  resolveKnownFeeAmount,
} from '../utils/tradeCosts.js';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from '../utils/formatters.js';

/**
 * 수수료 입력 한 벌(증권사 + 요율 또는 금액).
 *
 * 유관기관제비용 요율은 체결된 시장·세션에 따라 건마다 달라진다(실계좌에서
 * 0.0027%와 0.0032%가 섞여 나왔다). 요율만으로는 증권사 화면과 원 단위까지
 * 맞출 수 없어서, 수수료를 '금액'으로 바로 넣는 길을 함께 둔다.
 */
const BrokerFeeFields = ({
  idPrefix,
  label = '수수료',
  category,
  currency = 'KRW',
  brokerId,
  feeRatePercent,
  feeAmount = '',
  feeMode = 'rate',
  estimatedFee = 0,
  // 매도처럼 '증권사 화면 금액'만 받는 화면에서는 %/₩ 전환을 없애고 금액 입력만 남긴다.
  amountOnly = false,
  onChange,
}) => {
  const isAmountMode = amountOnly || feeMode === 'amount';
  const currencySymbol = { USD: '$', JPY: '¥', KRW: '₩' }[currency] || currency;
  // ₩로 바꿔만 두고 아직 비워 뒀다면 요율 계산이 그대로 쓰인다.
  // 그 사실을 말해주지 않으면 "0원이 들어갔겠지" 하고 넘어가게 된다.
  const usesRateFallback = isAmountMode && resolveKnownFeeAmount(feeAmount) === null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="flex items-center h-7 mb-1.5 ml-1">
          <label htmlFor={`${idPrefix}-broker`} className="block text-[11px] md:text-[12px] font-bold text-ink-mute">
            증권사
          </label>
        </div>
        <select
          id={`${idPrefix}-broker`}
          className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
          value={brokerId}
          onChange={(event) => {
            const nextBrokerId = event.target.value;
            onChange({
              brokerId: nextBrokerId,
              brokerFeeRate: formatFeeRateInput(getBrokerFeeRatePercent(nextBrokerId, category)),
              feeMode: amountOnly ? 'amount' : 'rate',
            });
          }}
        >
          {BROKER_FEE_PRESETS.map((broker) => (
            <option key={broker.id} value={broker.id}>{broker.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 h-7 mb-1.5 ml-1">
          <label htmlFor={`${idPrefix}-fee`} className="block text-[11px] md:text-[12px] font-bold text-ink-mute">
            {label}
          </label>
          {amountOnly ? (
            <span className="seg inline-flex items-center p-0.5 rounded-[10px]" aria-hidden="true">
              <span className="seg-item inline-flex items-center px-2 h-6 rounded-lg text-[11px] font-bold text-ink" data-active="true">
                {currencySymbol}
              </span>
            </span>
          ) : (
            <div className="seg inline-flex items-center p-0.5 rounded-[10px]" role="group" aria-label={`${label} 입력 방식`}>
              {[{ key: 'rate', text: '%' }, { key: 'amount', text: '₩' }].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={feeMode === option.key}
                  onClick={() => onChange({ feeMode: option.key })}
                  className={`seg-item px-2 h-6 rounded-lg text-[11px] font-bold ${
                    feeMode === option.key ? 'text-ink' : 'text-ink-mute'
                  }`}
                >
                  {option.text}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          id={`${idPrefix}-fee`}
          type="text"
          inputMode="decimal"
          className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
          value={isAmountMode ? formatInputNumber(feeAmount) : feeRatePercent}
          placeholder={isAmountMode ? '증권사 화면의 수수료 금액' : '0'}
          onChange={(event) => {
            const next = sanitizeNumericInput(event.target.value);
            onChange(isAmountMode
              ? { brokerFeeAmount: next }
              : { brokerId: 'custom', brokerFeeRate: next });
          }}
        />
        {estimatedFee > 0 && (!isAmountMode || usesRateFallback) && (
          <p className="text-[11px] font-semibold text-ink-mute mt-1.5 ml-1">
            {usesRateFallback ? '금액을 비워둬 요율 기준 ' : '예상 수수료 '}
            {formatMoney(estimatedFee, currency)}
            {usesRateFallback ? ' 적용 중' : ''}
          </p>
        )}
      </div>
    </div>
  );
};

export default BrokerFeeFields;
