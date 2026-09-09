import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '../utils/formatters.js';

const formatNativeAmount = ({ currency, amount }) => (
  ['KRW', 'USD', 'JPY'].includes(currency)
    ? formatMoney(amount, currency)
    : `${currency} ${amount.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
);

const DividendIncomeSummary = ({ year, summary, earliestYear, onYearChange }) => (
  <section aria-label={`${year}년 수령 배당 합계`} className="rounded-2xl bg-canvas p-4 md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs md:text-sm font-bold text-ink">{year}년 수령 배당 (확정)</h4>
      {onYearChange && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onYearChange(year - 1)} disabled={year <= earliestYear} aria-label="배당 이전 연도" className="p-2 text-ink-mute disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="text-xs font-bold text-ink">{year}</span>
          <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= new Date().getFullYear()} aria-label="배당 다음 연도" className="p-2 text-ink-mute disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
    <p className="figure text-xl md:text-2xl font-bold text-ink mt-2">{formatMoney(summary.totalKRW, 'KRW')}</p>
    {summary.totals.length > 0 && <p className="text-xs font-bold text-ink-soft mt-1">통화별 합계 · {summary.totals.map(formatNativeAmount).join(' + ')}</p>}
    <p className="text-[11px] font-semibold text-ink-mute mt-2 leading-relaxed">
      세후 · 한국 집계일 기준 · {summary.count}건 (실제 입금 {summary.manualCount}건 · 공식 자료 자동 계산 {summary.automaticCount}건)
    </p>
    <p className="text-[11px] font-semibold text-ink-mute mt-1 leading-relaxed">목표와 수익·배당에 같은 연도·입금 내역·환율을 적용합니다. 예정 배당은 제외합니다.</p>
    {summary.approximate && <p className="text-[11px] font-semibold text-warn mt-1">지급 시점 환율이 없는 내역은 현재 또는 기본 환율로 근사했습니다.</p>}
    {summary.unconvertedCount > 0 && <p className="text-[11px] font-semibold text-warn mt-1">환율 미확인 {summary.unconvertedCount}건은 통화별 합계에만 표시합니다. 원화 합계는 일부 금액입니다.</p>}
  </section>
);

export default DividendIncomeSummary;
