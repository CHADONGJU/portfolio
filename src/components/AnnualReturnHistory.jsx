import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '../utils/formatters.js';

const AnnualReturnHistory = ({ year, years, performance, performances, onYearChange }) => {
  const maxAbs = Math.max(1, ...performances.filter((item) => Number.isFinite(item.returnPercent)).map((item) => Math.abs(item.returnPercent)));
  const currentYear = new Date().getFullYear();

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-ink-soft" />
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink">연도별 수익률</h3>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">입출금을 수익과 분리한 TWR 기준입니다.</p>
          </div>
        </div>
        <div className="seg inline-flex self-start sm:self-auto items-center p-1 rounded-[14px]">
          <button type="button" onClick={() => onYearChange(year - 1)} aria-label="이전 연도" className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink"><ChevronLeft size={16} /></button>
          <span className="px-4 min-w-24 text-center text-sm font-bold text-ink">{year}</span>
          <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= currentYear} aria-label="다음 연도" className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="p-5 md:p-7 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-5">
        <div className="bg-canvas rounded-2xl p-5">
          <p className="text-[11px] font-bold text-ink-mute">{year === currentYear ? `${year}년 YTD` : `${year}년 연간`}</p>
          {performance.status === 'ready' ? (
            <>
              <p className={`figure text-3xl md:text-4xl font-bold mt-2 ${performance.returnPercent >= 0 ? 'text-up' : 'text-down'}`}>{performance.returnPercent >= 0 ? '+' : ''}{performance.returnPercent.toFixed(2)}%</p>
              <p className="text-xs font-semibold text-ink-mute mt-2">{performance.startDate} ~ {performance.endDate}{performance.estimated ? ' · 일부 구간 추정' : ''}</p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <div><p className="text-[10px] font-bold text-ink-mute">순수익</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.profitKRW, 'KRW')}</p></div>
                <div><p className="text-[10px] font-bold text-ink-mute">입금</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.depositsKRW, 'KRW')}</p></div>
                <div><p className="text-[10px] font-bold text-ink-mute">출금</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.withdrawalsKRW, 'KRW')}</p></div>
              </div>
            </>
          ) : (
            <div className="py-8">
              <p className="text-xl font-bold text-ink">평가 기록이 더 필요합니다.</p>
              <p className="text-xs font-semibold text-ink-mute mt-2 leading-relaxed">헤더의 계좌 관리에서 연초 평가액을 넣으면 자동으로 저장되는 현재 평가액과 연결해 계산합니다.</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {years.map((itemYear) => {
            const item = performances.find((candidate) => candidate.year === itemYear);
            const value = item?.returnPercent;
            const width = Number.isFinite(value) ? (Math.abs(value) / maxAbs) * 50 : 0;
            return (
              <button key={itemYear} type="button" onClick={() => onYearChange(itemYear)} className={`w-full rounded-xl px-4 py-3 text-left transition-colors ${itemYear === year ? 'bg-canvas ring-1 ring-line' : 'hover:bg-canvas'}`}>
                <div className="flex items-center justify-between gap-3 mb-2"><span className="text-xs md:text-sm font-bold text-ink">{itemYear}{itemYear === currentYear ? ' YTD' : ''}</span><span className={`figure text-xs md:text-sm font-bold ${!Number.isFinite(value) ? 'text-ink-mute' : value >= 0 ? 'text-up' : 'text-down'}`}>{Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '자료 부족'}</span></div>
                <div className="relative h-2 rounded-full bg-line-soft overflow-hidden"><span className="absolute left-1/2 top-0 h-full w-px bg-ink/20" />{Number.isFinite(value) && <span className={`absolute top-0 h-full rounded-full ${value >= 0 ? 'bg-up' : 'bg-down'}`} style={{ left: value >= 0 ? '50%' : `${50 - width}%`, width: `${Math.max(width, 1)}%` }} />}</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default AnnualReturnHistory;
