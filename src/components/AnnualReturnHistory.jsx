// 연도별 수익률 막대 그래프와 연도 선택기.
// 분모가 아주 작은 해가 나오면 막대 하나가 나머지를 전부 짜부라뜨리므로,
// 막대 길이만 상한을 두고 숫자 자체는 그대로 보여준다.
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '../utils/formatters.js';
import DividendIncomeSummary from './DividendIncomeSummary.jsx';
import { getAnnualReturnUnavailableMessage } from './annualReturnMessages.js';

// 구간은 언제나 1월 1일부터다. 기록을 언제 시작했든 라벨은 그 해를 가리킨다.
const getPeriodLabel = (year, currentYear) => (
  year === currentYear ? `${year}년 YTD` : `${year}년 연간`
);

// 수익률이 어떤 분모 위에 있는지 한 줄로. 환율을 몰라 오늘 환율로 근사한 옛 기록이
// 섞여 있으면 그 사실도 감추지 않는다.
const getBasisNote = (performance) => (
  performance?.approximate
    ? '투입원가 대비 · 일부 환율은 근사치'
    : '투입원가 대비 실현 수익률'
);

// 단순 비율(비가중) 수익률이라, 원금이 거의 없는 해에 입금과 출금이 거의 같은
// 금액으로 맞물리면 분모가 0에 가까워져 수백 %가 넘는 값이 나올 수 있다. 그런
// 한 해가 다른 정상적인 해들의 막대를 전부 안 보일 정도로 짜부라뜨리지 않도록,
// 막대 길이 계산에서만 이 값 이상은 "다 찼다"로 본다(숫자 자체는 그대로 보여준다).
const CHART_PERCENT_CAP = 300;
const clampedAbsPercent = (value) => Math.min(Math.abs(value), CHART_PERCENT_CAP);

const AnnualReturnHistory = ({ year, years, earliestYear, performance, performances, onYearChange, includeDividends, onIncludeDividendsChange }) => {
  // 기록이 없는 해를 보고 있어도 오른쪽 목록에서 그 해가 보이고 선택 표시가
  // 되도록, 기록이 있는 연도 목록에 지금 보고 있는 해를 합쳐서 그린다.
  const displayYears = years.includes(year) ? years : [...years, year].sort((left, right) => right - left);
  const maxAbs = Math.max(
    1,
    ...performances.filter((item) => Number.isFinite(item.returnPercent)).map((item) => clampedAbsPercent(item.returnPercent)),
  );
  const currentYear = new Date().getFullYear();

  return (
    <section aria-label="연도별 수익률" className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-ink-soft" />
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink">연도별 수익률</h3>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">{includeDividends ? '(매매 실현손익 + 수령 배당)' : '매매 실현손익'} ÷ (연초 보유원가 + 연중 매수금액)</p>
          </div>
        </div>
        <div className="seg inline-flex self-start sm:self-auto items-center p-1 rounded-[14px]">
          <button type="button" onClick={() => onYearChange(year - 1)} disabled={year <= earliestYear} aria-label="이전 연도" className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="px-4 min-w-24 text-center text-sm font-bold text-ink">{year}</span>
          <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= currentYear} aria-label="다음 연도" className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="px-5 md:px-7 pt-5">
        <label className="inline-flex items-center gap-3 cursor-pointer text-sm font-bold text-ink">
          <input type="checkbox" role="switch" checked={includeDividends} onChange={(event) => onIncludeDividendsChange(event.target.checked)} className="h-5 w-5 accent-brand" />
          수익률에 확정 배당 포함
        </label>
        <p className="text-[11px] font-semibold text-ink-mute mt-2 leading-relaxed">목표 달성률과 모든 연도에 함께 적용되며 설정이 저장됩니다. 매매 수수료·거래세와 세후 배당을 반영하며, 평가손익·양도소득세는 제외합니다.</p>
        <p className="text-[11px] font-semibold text-ink-mute mt-1 leading-relaxed">배당과 원금의 범위를 맞추기 위해 기존 매도원가 기준을 투입원가 기준으로 변경했습니다. 재투자 매수도 원가에 다시 더하므로 전체 자산의 총수익률·연환산 수익률과 다릅니다.</p>
      </div>

      <div className="p-5 md:p-7 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-5">
        <div className="bg-canvas rounded-2xl p-5">
          <p className="text-[11px] font-bold text-ink-mute">{getPeriodLabel(year, currentYear)}</p>
          {performance.status === 'ready' ? (
            <>
              <p className={`figure text-3xl md:text-4xl font-bold mt-2 ${performance.returnPercent >= 0 ? 'text-up' : 'text-down'}`}>{performance.returnPercent >= 0 ? '+' : ''}{performance.returnPercent.toFixed(2)}%</p>
              <p className="text-xs font-semibold text-ink-mute mt-2">{getBasisNote(performance)}</p>
            </>
          ) : (
            <div className="py-8">
              <p className="text-xl font-bold text-ink">계산 기준이 더 필요합니다.</p>
              <p className="text-xs font-semibold text-ink-mute mt-2 leading-relaxed">{getAnnualReturnUnavailableMessage(performance)}</p>
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div><p className="text-[10px] font-bold text-ink-mute">매매 실현손익</p><p className="text-sm font-bold text-ink mt-1">{formatMoney(performance.profitKRW, 'KRW')}</p></div>
            <div><p className="text-[10px] font-bold text-ink-mute">수익률 반영 배당</p><p className="text-sm font-bold text-ink mt-1">{formatMoney(performance.includedDividendsKRW || 0, 'KRW')}</p></div>
            <div><p className="text-[10px] font-bold text-ink-mute">연초 보유원가</p><p className="text-sm font-bold text-ink mt-1">{formatMoney(performance.openingCostKRW || 0, 'KRW')}</p></div>
            <div><p className="text-[10px] font-bold text-ink-mute">연중 매수금액 (수수료 포함)</p><p className="text-sm font-bold text-ink mt-1">{formatMoney(performance.periodBuyCostKRW || 0, 'KRW')}</p></div>
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <DividendIncomeSummary year={year} summary={performance.dividendIncome} />
          </div>
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
