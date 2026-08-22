import { BROKER_FEE_PRESETS, formatFeeRateInput, getBrokerFeeRatePercent } from '../utils/tradeCosts.js';
import { formatMoney, sanitizeNumericInput } from '../utils/formatters.js';

/**
 * 매수 수수료 입력 한 벌(증권사 + 수수료율).
 *
 * 매수 수수료를 기록해 두지 않으면 나중에 실현손익에서 뺄 수도, 해외주식
 * 양도소득세의 필요경비로 넣을 수도 없다. 그래서 매수 시점에 함께 받는다.
 * 기본값은 '직접 입력'(0%)이라 예전처럼 비워 두어도 계산이 달라지지 않는다.
 */
const BrokerFeeFields = ({
  idPrefix,
  category,
  currency = 'KRW',
  brokerId,
  feeRatePercent,
  estimatedFee = 0,
  onChange,
}) => (
  <div className="grid grid-cols-2 gap-3">
    <div>
      <label htmlFor={`${idPrefix}-broker`} className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
        증권사
      </label>
      <select
        id={`${idPrefix}-broker`}
        className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
        value={brokerId}
        onChange={(event) => {
          const nextBrokerId = event.target.value;
          onChange({
            brokerId: nextBrokerId,
            brokerFeeRate: formatFeeRateInput(getBrokerFeeRatePercent(nextBrokerId, category)),
          });
        }}
      >
        {BROKER_FEE_PRESETS.map((broker) => (
          <option key={broker.id} value={broker.id}>{broker.name}</option>
        ))}
      </select>
    </div>
    <div>
      <label htmlFor={`${idPrefix}-fee`} className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
        매수 수수료율(%)
      </label>
      <input
        id={`${idPrefix}-fee`}
        type="text"
        inputMode="decimal"
        className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
        value={feeRatePercent}
        onChange={(event) => onChange({
          brokerId: 'custom',
          brokerFeeRate: sanitizeNumericInput(event.target.value),
        })}
      />
      {estimatedFee > 0 && (
        <p className="text-[11px] font-semibold text-ink-mute mt-1.5 ml-1">
          예상 수수료 {formatMoney(estimatedFee, currency)}
        </p>
      )}
    </div>
  </div>
);

export default BrokerFeeFields;
