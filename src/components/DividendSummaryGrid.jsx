import { Banknote, DollarSign } from 'lucide-react';
import FeatureInfo from './FeatureInfo';
import { formatMoney } from '../utils/formatters';
import {
  getDividendEligibilityDate,
  getDividendExDate,
  getDividendOfficialPaymentDate,
} from '../utils/dividendDates';

const DividendSummaryGrid = ({ groups, onSelect }) => groups.flatMap((group) => [
  <div key={`${group.id}-heading`} className="col-span-full flex items-center justify-between pt-1 md:pt-2">
    <div className="flex items-center gap-2.5">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${group.id === 'domestic' ? 'bg-up-soft text-up' : 'bg-brand-soft text-brand'}`}>
        {group.id === 'domestic' ? <Banknote size={17} /> : <DollarSign size={17} />}
      </span>
      <div className="flex items-center gap-2">
        <h4 className="text-sm md:text-base font-bold text-ink">{group.label}</h4>
        <FeatureInfo text={group.description} />
      </div>
    </div>
    <span className="text-[11px] font-bold text-ink-mute">{group.items.length}종목</span>
  </div>,
  ...group.items.map((summary) => {
    const latestDividend = Array.isArray(summary.history) ? summary.history[0] : null;
    const dividendRecordDate = latestDividend
      ? latestDividend.recordDate || getDividendEligibilityDate(latestDividend) || getDividendExDate(latestDividend)
      : '';
    const dividendPaymentDate = latestDividend ? getDividendOfficialPaymentDate(latestDividend) : '';
    const isDomestic = group.id === 'domestic';

    return (
      <button
        type="button"
        key={summary.name}
        onClick={() => onSelect(summary.name)}
        className="w-full text-left p-5 md:p-6 bg-canvas rounded-[20px] border border-line cursor-pointer transition-all group hover:bg-surface hover:shadow-lift hover:-translate-y-px"
      >
        <div className="flex justify-between items-start mb-4 md:mb-6">
          <div className="whitespace-nowrap overflow-hidden pr-3 md:pr-4">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDomestic ? 'bg-up' : 'bg-brand'}`} />
              <p className="text-[11px] md:text-[12px] text-ink-mute font-bold truncate">
                {isDomestic ? '국내 · KRW' : `해외 · ${summary.currency}`}
              </p>
            </div>
            <h4 className="font-bold text-ink text-base md:text-lg mt-1 truncate">{summary.name}</h4>
          </div>
          <div className="text-right whitespace-nowrap shrink-0">
            <p className="text-[11px] md:text-[12px] text-ink-mute font-bold mb-0.5 md:mb-1">세후 누적 배당금</p>
            <p className="figure text-lg md:text-xl font-bold text-ink">{formatMoney(summary.totalAmount, summary.currency)}</p>
          </div>
        </div>

        <div className="space-y-1.5 mb-4 text-[11px] md:text-[12px] font-bold text-ink-mute">
          <p>배당기준일 {dividendRecordDate || '미정'}</p>
          <p>공식 배당지급일 {dividendPaymentDate || '미정'}</p>
        </div>

        <div className="pt-4 border-t border-line-soft flex items-end justify-between gap-3">
          <div className={`inline-flex items-center px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[12px] md:text-[13px] font-bold ${summary.status.includes('반영') ? 'bg-brand-soft text-brand' : 'bg-line-soft text-ink-soft'}`}>
            {summary.status} {summary.status.includes('예상') && `(세후 ≈ ${formatMoney(summary.expectedAmount, summary.currency)})`}
          </div>
          <div
            className="text-right whitespace-nowrap shrink-0"
            title="최근 세후 배당과 지급주기를 연간 환산한 뒤 현재 평가금액으로 나눈 값"
          >
            <p className="text-[10px] md:text-[11px] font-bold text-ink-mute">예상 세후 연 배당률</p>
            <p className={`figure text-base md:text-lg font-bold mt-0.5 ${Number.isFinite(summary.annualDividendYieldPercent) ? 'text-up' : 'text-ink-mute'}`}>
              {Number.isFinite(summary.annualDividendYieldPercent)
                ? `${summary.annualDividendYieldPercent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                : '—'}
            </p>
          </div>
        </div>
      </button>
    );
  }),
]);

export default DividendSummaryGrid;
