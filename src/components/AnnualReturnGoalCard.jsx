import { ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters.js';

const AnnualReturnGoalCard = ({ year, targetPercent, performance, onTargetChange, onYearChange }) => {
  const currentYear = new Date().getFullYear();
  const actual = Number.isFinite(performance?.returnPercent) ? performance.returnPercent : null;
  const target = Number(targetPercent) || 0;
  const min = Math.min(0, actual ?? 0);
  const max = Math.max(1, target, actual ?? 0);
  const range = max - min || 1;
  const zeroPosition = ((0 - min) / range) * 100;
  const actualPosition = actual === null ? zeroPosition : ((actual - min) / range) * 100;
  const targetPosition = ((target - min) / range) * 100;
  const fillLeft = Math.min(zeroPosition, actualPosition);
  const fillWidth = Math.abs(actualPosition - zeroPosition);

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-ink-soft" />
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink">{year}년 목표 수익률</h3>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">목표는 이곳에서 설정하고 실제 결과는 수익·배당에서 확인합니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <div className="seg inline-flex items-center p-1 rounded-xl">
            <button type="button" onClick={() => onYearChange(year - 1)} aria-label="목표 이전 연도" className="seg-item w-9 h-9 grid place-items-center rounded-lg text-ink-mute hover:text-ink"><ChevronLeft size={15} /></button>
            <span className="px-2 text-xs font-bold text-ink">{year}</span>
            <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= currentYear} aria-label="목표 다음 연도" className="seg-item w-9 h-9 grid place-items-center rounded-lg text-ink-mute hover:text-ink disabled:opacity-30"><ChevronRight size={15} /></button>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink-mute">목표</span>
            <span className="relative">
              <input inputMode="decimal" value={formatInputNumber(targetPercent)} onChange={(event) => onTargetChange(sanitizeNumericInput(event.target.value))} placeholder="10" className="w-28 h-11 pl-4 pr-8 bg-canvas rounded-xl text-right text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-mute">%</span>
            </span>
          </label>
        </div>
      </div>
      <div className="p-5 md:p-7">
        <div className="flex items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-[11px] font-bold text-ink-mute">현재 수익률</p>
            <p className={`figure text-3xl font-bold mt-1 ${actual === null ? 'text-ink-mute' : actual >= 0 ? 'text-up' : 'text-down'}`}>{actual === null ? '계산 준비 중' : `${actual >= 0 ? '+' : ''}${actual.toFixed(2)}%`}</p>
          </div>
          <p className="text-xs md:text-sm font-bold text-ink-soft">{target > 0 && actual !== null ? `달성률 ${Math.round((actual / target) * 100)}%` : '목표와 매매 기록이 필요합니다.'}</p>
        </div>
        <div className="relative h-5 rounded-full bg-line-soft overflow-visible">
          <span className="absolute top-0 h-full w-px bg-ink/40" style={{ left: `${zeroPosition}%` }} />
          {actual !== null && <span className={`absolute top-0 h-full rounded-full ${actual >= 0 ? 'bg-up' : 'bg-down'}`} style={{ left: `${fillLeft}%`, width: `${Math.max(fillWidth, 0.8)}%` }} />}
          {target > 0 && <span className="absolute -top-2 h-9 w-0.5 bg-ink rounded-full" style={{ left: `${targetPosition}%` }} title={`목표 ${target}%`} />}
        </div>
        <div className="mt-3 flex justify-between text-[11px] font-bold text-ink-mute"><span>{min.toFixed(1)}%</span><span>목표 {target > 0 ? `${target}%` : '미설정'}</span></div>
      </div>
    </section>
  );
};

export default AnnualReturnGoalCard;
