import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '../utils/formatters';
import FeatureInfo from './FeatureInfo';

const DIVIDEND_GREEN_COLORS = [
  '#064e3b',
  '#047857',
  '#059669',
  '#10b981',
  '#34d399',
];
const OTHER_COLOR = '#a7f3d0';

const formatCompactKrw = (amount) => new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(Math.round(Number(amount) || 0));

const getSegmentColor = (name, assetIndex) => (
  name === '기타'
    ? OTHER_COLOR
    : DIVIDEND_GREEN_COLORS[assetIndex % DIVIDEND_GREEN_COLORS.length]
);

const AnnualDividendTrend = ({ year, trend, isFxLoading, onYearChange }) => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const latestMonthWithData = [...trend.months]
    .reverse()
    .find((month) => month.total > 0)?.month;
  const initialMonth = latestMonthWithData || (year === currentYear ? currentMonth : 12);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  const selectedMonthData = trend.months.find((month) => month.month === selectedMonth) || trend.months[0];
  const detailRows = useMemo(() => {
    const rows = new Map();
    selectedMonthData.events.forEach((event) => {
      const key = `${event.name}::${event.currency}::${event.isEstimated ? 'estimated' : 'confirmed'}`;
      const row = rows.get(key) || {
        key,
        name: event.name,
        ticker: event.ticker,
        currency: event.currency,
        nativeAmount: 0,
        krwAmount: 0,
        count: 0,
        isEstimated: event.isEstimated,
      };
      row.nativeAmount += event.amount;
      row.krwAmount += event.krwAmount;
      row.count += 1;
      rows.set(key, row);
    });
    return [...rows.values()].sort((left, right) => right.krwAmount - left.krwAmount);
  }, [selectedMonthData.events]);

  const legendItems = [
    ...trend.topAssets.map((asset, index) => ({
      name: asset.name,
      color: getSegmentColor(asset.name, index),
    })),
    ...(trend.hasOther ? [{ name: '기타', color: OTHER_COLOR }] : []),
  ];

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base md:text-lg font-bold text-ink flex items-center gap-2">
            <BarChart3 size={18} className="text-ink-soft" />
            연간 배당 흐름
          </h3>
          <FeatureInfo text="지급월별 세후 배당 전망입니다. 실제 수령 기록과 최근 배당 주기를 반복한 향후 예상이 함께 있으며, 빗금은 아직 공시되지 않은 추정값입니다." />
        </div>

        <div className="seg inline-flex self-start lg:self-auto items-center gap-0.5 p-1 rounded-[14px]">
          <button
            type="button"
            onClick={() => onYearChange(year - 1)}
            aria-label="이전 연도"
            className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink hover:bg-surface"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-4 min-w-24 text-center text-xs md:text-sm font-bold text-ink tabular-nums">
            {year}
          </div>
          <button
            type="button"
            onClick={() => onYearChange(year + 1)}
            aria-label="다음 연도"
            className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink hover:bg-surface"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="p-5 md:p-7">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="bg-canvas rounded-2xl p-4 md:p-5">
            <p className="text-[11px] md:text-xs font-bold text-ink-mute mb-1">연간 세후 배당 전망</p>
            <p className="figure text-xl md:text-2xl font-bold text-ink">{formatMoney(trend.annualTotal, 'KRW')}</p>
            <p className="text-[11px] font-semibold text-ink-mute mt-1">
              확정 {formatMoney(trend.confirmedTotal, 'KRW')} · 예상 {formatMoney(trend.estimatedTotal, 'KRW')}
            </p>
          </div>
          <div className="bg-canvas rounded-2xl p-4 md:p-5">
            <p className="text-[11px] md:text-xs font-bold text-ink-mute mb-1">월평균 세후 배당</p>
            <p className="figure text-xl md:text-2xl font-bold text-ink">{formatMoney(trend.monthlyAverage, 'KRW')}</p>
            <p className="text-[11px] font-semibold text-ink-mute mt-1">
              연간 전망 ÷ 12{isFxLoading ? ' · 지급일 환율 확인 중' : ''}
            </p>
          </div>
        </div>

        {trend.eventCount > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
              {legendItems.map((item) => (
                <span key={item.name} className="inline-flex items-center gap-1.5 text-[11px] md:text-xs font-bold text-ink-soft">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                  {item.name}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 text-[11px] md:text-xs font-bold text-ink-mute">
                <span
                  className="w-4 h-2.5 rounded-sm border border-line-soft"
                  style={{
                    backgroundColor: 'transparent',
                    backgroundImage: 'repeating-linear-gradient(135deg, #059669 0 2px, transparent 2px 6px)',
                  }}
                />
                향후 예상
              </span>
            </div>

            <div className="overflow-x-auto scroll-soft pb-2">
              {/* 390px 화면에서 min-w-[760px]는 7~12월이 늘 화면 밖이라, 좁은 화면에서는
                  막대를 줄여 12개월이 한눈에 들어오게 한다. */}
              <div className="min-w-[520px] sm:min-w-[760px] h-[300px] border-b border-line flex items-end gap-1.5 sm:gap-2 md:gap-3 px-2 pt-8">
                {trend.months.map((month) => {
                  const barHeight = trend.maxMonthTotal > 0
                    ? (month.total / trend.maxMonthTotal) * 220
                    : 0;
                  return (
                    <button
                      key={month.month}
                      type="button"
                      onClick={() => setSelectedMonth(month.month)}
                      aria-label={`${month.month}월 세후 배당 ${formatMoney(month.total, 'KRW')}`}
                      /* focus:outline-none만 두면 전역 :focus-visible 규칙보다 특이도가
                         높아 차트 전체에 포커스 표시가 사라진다. 대체 링을 함께 준다. */
                      className="group flex-1 h-full min-w-9 sm:min-w-12 flex flex-col items-center justify-end focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-lg"
                    >
                      <span className={`figure text-[10px] md:text-[11px] font-bold mb-2 transition-colors ${selectedMonth === month.month ? 'text-ink' : 'text-ink-mute group-hover:text-ink'}`}>
                        {month.total > 0 ? formatCompactKrw(month.total) : '—'}
                      </span>
                      <span
                        className={`w-full max-w-12 min-h-0 rounded-t-lg overflow-hidden flex flex-col-reverse transition-all ${selectedMonth === month.month ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'group-hover:opacity-85'}`}
                        style={{ height: `${barHeight}px` }}
                      >
                        {month.segments.map((segment) => {
                          const assetIndex = Math.max(0, trend.topAssets.findIndex((asset) => asset.name === segment.name));
                          const color = getSegmentColor(segment.name, assetIndex);
                          const heightPercent = month.total > 0 ? (segment.amount / month.total) * 100 : 0;
                          return (
                            <span
                              key={segment.key}
                              title={`${segment.name} ${segment.isEstimated ? '예상' : '확정'} ${formatMoney(segment.amount, 'KRW')}`}
                              style={{
                                height: `${heightPercent}%`,
                                minHeight: segment.amount > 0 ? '2px' : 0,
                                backgroundColor: segment.isEstimated ? 'transparent' : color,
                                backgroundImage: segment.isEstimated
                                  ? `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 7px)`
                                  : 'none',
                              }}
                            />
                          );
                        })}
                      </span>
                      <span className={`mt-2 text-[11px] md:text-xs font-bold ${selectedMonth === month.month ? 'text-ink' : 'text-ink-mute'}`}>
                        {month.month}월
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-2xl bg-canvas p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-[11px] font-bold text-ink-mute">선택한 달</p>
                  <h4 className="text-sm md:text-base font-bold text-ink mt-0.5">
                    {year}년 {selectedMonth}월 · {formatMoney(selectedMonthData.total, 'KRW')}
                  </h4>
                </div>
                <span className="text-[11px] font-bold text-ink-mute">세후 · 원화 환산</span>
              </div>

              {detailRows.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {detailRows.map((row) => (
                    <div key={row.key} className="bg-surface border border-line-soft rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs md:text-sm font-bold text-ink truncate">{row.name}</p>
                        <p className="text-[11px] font-semibold text-ink-mute mt-0.5">
                          {row.isEstimated ? '예상' : '지급 확정'}{row.count > 1 ? ` ${row.count}건` : ''} · {formatMoney(row.nativeAmount, row.currency)}
                        </p>
                      </div>
                      <p className="figure text-xs md:text-sm font-bold text-ink shrink-0">{formatMoney(row.krwAmount, 'KRW')}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs md:text-sm font-bold text-ink-mute">이 달의 배당 기록이 없습니다.</p>
              )}
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-xs md:text-sm font-bold text-ink-mute">
            {year}년에 표시할 배당 기록이나 예상 일정이 없습니다.
          </div>
        )}
      </div>
    </section>
  );
};

export default AnnualDividendTrend;
