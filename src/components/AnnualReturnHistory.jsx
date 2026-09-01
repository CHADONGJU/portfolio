import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '../utils/formatters.js';

// 구간은 언제나 1월 1일부터다. 기록을 언제 시작했든 라벨은 그 해를 가리킨다.
const getPeriodLabel = (year, currentYear) => (
  year === currentYear ? `${year}년 YTD` : `${year}년 연간`
);

const getInsufficientMessage = (performance) => {
  if ((performance?.buyCount || 0) > 0 && (performance?.sellCount || 0) === 0) return '아직 매도한 기록이 없습니다. 매도가 생기면 그 해 매매 수익률을 자동 계산합니다.';
  return '이 해의 매매 기록이 아직 없습니다. 매수·매도 기록을 넣으면 자동 계산합니다.';
};

// 수익률이 어떤 분모 위에 있는지 한 줄로. 환율을 몰라 오늘 환율로 근사한 옛 기록이
// 섞여 있으면 그 사실도 감추지 않는다.
const getBasisNote = (performance) => (
  performance?.approximate
    ? '매도분 매수원가 대비 · 일부 옛 기록은 오늘 환율로 근사'
    : '매도분 매수원가 대비'
);

// 단순 비율(비가중) 수익률이라, 원금이 거의 없는 해에 입금과 출금이 거의 같은
// 금액으로 맞물리면 분모가 0에 가까워져 수백 %가 넘는 값이 나올 수 있다. 그런
// 한 해가 다른 정상적인 해들의 막대를 전부 안 보일 정도로 짜부라뜨리지 않도록,
// 막대 길이 계산에서만 이 값 이상은 "다 찼다"로 본다(숫자 자체는 그대로 보여준다).
const CHART_PERCENT_CAP = 300;
const clampedAbsPercent = (value) => Math.min(Math.abs(value), CHART_PERCENT_CAP);

const AnnualReturnHistory = ({ year, years, earliestYear, performance, performances, onYearChange }) => {
  // 기록이 없는 해를 보고 있어도 오른쪽 목록에서 그 해가 보이고 선택 표시가
  // 되도록, 기록이 있는 연도 목록에 지금 보고 있는 해를 합쳐서 그린다.
  const displayYears = years.includes(year) ? years : [...years, year].sort((left, right) => right - left);
  const maxAbs = Math.max(
    1,
    ...performances.filter((item) => Number.isFinite(item.returnPercent)).map((item) => clampedAbsPercent(item.returnPercent)),
  );
  const currentYear = new Date().getFullYear();

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-ink-soft" />
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink">연도별 수익률</h3>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">매도 실현손익(수수료·거래세 차감)을 매도분 매수원가로 나눈 매매 수익률입니다. 배당·평가손익은 수익률에 넣지 않습니다.</p>
          </div>
        </div>
        <div className="seg inline-flex self-start sm:self-auto items-center p-1 rounded-[14px]">
          <button type="button" onClick={() => onYearChange(year - 1)} disabled={year <= earliestYear} aria-label="이전 연도" className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="px-4 min-w-24 text-center text-sm font-bold text-ink">{year}</span>
          <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= currentYear} aria-label="다음 연도" className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="p-5 md:p-7 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-5">
        <div className="bg-canvas rounded-2xl p-5">
          <p className="text-[11px] font-bold text-ink-mute">{getPeriodLabel(year, currentYear)}</p>
          {performance.status === 'ready' ? (
            <>
              <p className={`figure text-3xl md:text-4xl font-bold mt-2 ${performance.returnPercent >= 0 ? 'text-up' : 'text-down'}`}>{performance.returnPercent >= 0 ? '+' : ''}{performance.returnPercent.toFixed(2)}%</p>
              <p className="text-xs font-semibold text-ink-mute mt-2">{getBasisNote(performance)}</p>
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><p className="text-[10px] font-bold text-ink-mute">실현손익</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.profitKRW, 'KRW')}</p></div>
                <div><p className="text-[10px] font-bold text-ink-mute">총 매수금액</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.buyKRW, 'KRW')}</p></div>
                <div><p className="text-[10px] font-bold text-ink-mute">총 매도금액</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.sellKRW, 'KRW')}</p></div>
                <div><p className="text-[10px] font-bold text-ink-mute">배당 (수익률 미포함)</p><p className="text-xs md:text-sm font-bold text-ink mt-1">{formatMoney(performance.dividendsKRW || 0, 'KRW')}</p></div>
              </div>
            </>
          ) : (
            <div className="py-8">
              <p className="text-xl font-bold text-ink">계산 기준이 더 필요합니다.</p>
              <p className="text-xs font-semibold text-ink-mute mt-2 leading-relaxed">{getInsufficientMessage(performance)}</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {displayYears.map((itemYear) => {
            const item = performances.find((candidate) => candidate.year === itemYear);
            const value = item?.returnPercent;
            const width = Number.isFinite(value) ? (clampedAbsPercent(value) / maxAbs) * 50 : 0;
            return (
              <button key={itemYear} type="button" onClick={() => onYearChange(itemYear)} className={`w-full rounded-xl px-4 py-3 text-left transition-colors ${itemYear === year ? 'bg-canvas ring-1 ring-line' : 'hover:bg-canvas'}`}>
                <div className="flex items-center justify-between gap-3 mb-2"><span className="text-xs md:text-sm font-bold text-ink">{getPeriodLabel(itemYear, currentYear)}</span><span className={`figure text-xs md:text-sm font-bold ${!Number.isFinite(value) ? 'text-ink-mute' : value >= 0 ? 'text-up' : 'text-down'}`}>{Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '자료 부족'}</span></div>
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
