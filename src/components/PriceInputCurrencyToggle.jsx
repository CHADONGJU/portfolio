// 외화 종목의 매수 단가를 "현지 통화"로 넣을지 "원화"로 넣을지 고르는 토글.
// 원화로 넣으면 매수일 환율로 현지 단가를 역산하므로, 증권사 앱에 찍힌 원화
// 금액을 그대로 옮겨 적을 수 있다. 자산 추가와 추가 매수 모달이 함께 쓴다.
import { getCurrencySymbol } from '../utils/formatters.js';

const PriceInputCurrencyToggle = ({ nativeCurrency, value, onChange }) => (
  <div className="seg inline-flex items-center p-0.5 rounded-[10px]" role="group" aria-label="입력 통화">
    {[
      { key: 'NATIVE', label: `${getCurrencySymbol(nativeCurrency)} ${nativeCurrency}` },
      { key: 'KRW', label: '₩ 원화' },
    ].map((option) => {
      const active = (value === 'KRW' ? 'KRW' : 'NATIVE') === option.key;
      return (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={active}
          className={`seg-item px-2.5 py-1 rounded-lg text-[11px] md:text-[12px] font-bold leading-none ${
            active ? 'text-ink' : 'text-ink-mute hover:text-ink-soft'
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

export default PriceInputCurrencyToggle;
