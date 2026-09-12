// 투자 캘린더 탭.
// 배당 캘린더(월별 달력 + 날짜별 배당 일정 + 선택한 일정 상세 + 연간 추이)와
// 주요 증시 일정 캘린더를 토글로 전환해 보여준다. 계산은 하지 않고, App이
// 넘겨준 일정·합계를 그리기만 한다.
import { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from 'lucide-react';
import FeatureInfo from '../FeatureInfo.jsx';
import MarketCalendar from '../MarketCalendar.jsx';
import AnnualDividendTrend from '../AnnualDividendTrend.jsx';
import { formatMoney } from '../../utils/formatters.js';
import { addMonthsClamped } from '../../utils/dividendInterval.js';

const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const CalendarTab = ({
  calendarView,
  setCalendarView,
  calendarMonth,
  setCalendarMonth,
  dividendCalendarCells,
  dividendCalendarEventsByDate,
  dividendCalendarMonthlySummary,
  selectedCalendarEvent,
  setSelectedCalendarEventId,
  expandedCalendarDate,
  setExpandedCalendarDate,
  expandedCalendarEvents,
  annualDividendTrend,
  annualDividendYear,
  annualDividendFxLookupDates,
  marketCalendarKeywords,
  addMarketCalendarKeyword,
  removeMarketCalendarKeyword,
}) => {
  /**
   * 배당 달력은 42칸 중 배당이 찍히는 날이 0~3일뿐이라, 배당이 없는 달에는
   * 700px 가까운 빈 격자만 남는다. 그 달은 접은 채로 열고(아래 연간 배당 흐름이
   * 훨씬 많은 것을 말해 준다), 사용자가 직접 편 경우에만 펼친다.
   * 선택은 그 달에만 적용되므로 달을 옮기면 다시 자동 판단으로 돌아간다.
   */
  const [gridChoice, setGridChoice] = useState(null);
  const monthHasDividends = dividendCalendarCells.some((cell) => (
    (dividendCalendarEventsByDate[cell.dateKey] || []).length > 0
  ));
  const isGridOpen = gridChoice?.month === calendarMonth ? gridChoice.open : monthHasDividends;

  return (
    <div className="space-y-6 anim-fade">
    <div className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="shrink-0 text-ink-soft" />
          <h3 className="sr-only">투자 캘린더</h3>
          <div className="seg flex items-center gap-0.5 p-1 rounded-[14px]" role="tablist" aria-label="캘린더 종류">
            <button
              type="button"
              role="tab"
              aria-selected={calendarView === 'dividend'}
              data-active={calendarView === 'dividend'}
              onClick={() => setCalendarView('dividend')}
              className="seg-item rounded-[10px] px-3 py-2 text-xs md:text-sm font-bold whitespace-nowrap text-ink-mute hover:text-ink"
            >
              배당 캘린더
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={calendarView === 'market'}
              data-active={calendarView === 'market'}
              onClick={() => setCalendarView('market')}
              className="seg-item rounded-[10px] px-3 py-2 text-xs md:text-sm font-bold whitespace-nowrap text-ink-mute hover:text-ink"
            >
              주요 증시 일정
            </button>
          </div>
          <FeatureInfo text={calendarView === 'dividend' ? '캘린더와 그래프는 같은 지급 일정과 세후 금액을 사용합니다. 공시 지급일은 한국시간 기준이며, 예상 지급일은 최근 배당 주기와 지급 간격으로 추정합니다.' : '미국·한국·유로존·중국·일본의 중요 일정과 관심 키워드 일정을 한국시간으로 표시합니다.'} />
        </div>
        <div className="seg flex items-center gap-0.5 p-1 rounded-[14px]">
          <button
            onClick={() => setCalendarMonth(getMonthKey(addMonthsClamped(new Date(`${calendarMonth}-01T00:00:00`), -1)))}
            aria-label="이전 달"
            className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink hover:bg-surface"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 min-w-24 text-center text-xs md:text-sm font-bold text-ink tabular-nums">
            {calendarMonth}
          </div>
          <button
            onClick={() => setCalendarMonth(getMonthKey(addMonthsClamped(new Date(`${calendarMonth}-01T00:00:00`), 1)))}
            aria-label="다음 달"
            className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink hover:bg-surface"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {calendarView === 'dividend' ? (
      <>
      <div role="region" aria-label="월별 배당 합계" className="px-5 py-4 md:px-7 md:py-5 border-b border-line bg-canvas/60 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-[12px] md:text-xs font-bold text-ink-mute">
            {calendarMonth.replace('-', '년 ')}월 세후 예상 배당 합계
          </p>
          <p className="text-[11px] md:text-[12px] font-semibold text-ink-mute mt-1">
            지급 확정 {dividendCalendarMonthlySummary.confirmedCount.toLocaleString()}건 · 예상 {dividendCalendarMonthlySummary.estimatedCount.toLocaleString()}건 · 통화별 합계
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setGridChoice({ month: calendarMonth, open: !isGridOpen })}
              aria-expanded={isGridOpen}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-xl bg-surface border border-line-soft text-xs font-bold text-ink-soft hover:text-ink hover:border-line transition-colors"
            >
              {isGridOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              달력 {isGridOpen ? '접기' : '펼치기'}
            </button>
            {dividendCalendarMonthlySummary.totals.length > 0 ? (
              dividendCalendarMonthlySummary.totals.map(({ currency, amount }) => (
                <span key={currency} className="figure px-3 py-2 rounded-xl bg-surface border border-line-soft text-sm md:text-base font-bold text-ink">
                  {formatMoney(amount, currency)}
                </span>
              ))
            ) : (
              <span className="text-xs md:text-sm font-bold text-ink-mute">예정 금액 없음</span>
            )}
          </div>
          {dividendCalendarMonthlySummary.totals.length > 0 && (
            <p className="figure text-xs font-semibold text-ink-mute">
              원화 환산 {formatMoney(annualDividendTrend.months[Number(calendarMonth.slice(5, 7)) - 1].total, 'KRW')}
            </p>
          )}
        </div>
      </div>

      {isGridOpen && (
      <div className="p-4 md:p-7">
        <div className="grid grid-cols-7 gap-1.5 md:gap-2 mb-2">
          {CALENDAR_WEEKDAYS.map((weekday, weekdayIndex) => (
            <div
              key={weekday}
              className={`text-center text-[11px] md:text-[12px] font-bold tracking-[0.06em] py-2 ${weekdayIndex === 0 ? 'text-up/70' : weekdayIndex === 6 ? 'text-down/70' : 'text-ink-mute'}`}
            >
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5 md:gap-2">
          {dividendCalendarCells.map((cell) => {
            const events = dividendCalendarEventsByDate[cell.dateKey] || [];
            return (
              <div
                key={cell.dateKey}
                className={`min-h-20 md:min-h-28 rounded-xl border p-2 transition-colors ${cell.isCurrentMonth ? 'bg-surface border-line-soft' : 'bg-canvas/50 border-transparent text-ink-mute'}`}
              >
                <div className={`text-[12px] md:text-xs font-semibold mb-1.5 tabular-nums ${cell.isCurrentMonth ? 'text-ink-soft' : 'text-ink-mute/70'}`}>
                  {cell.day}
                </div>
                <div className="space-y-1">
                  {events.slice(0, 3).map((event) => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedCalendarEventId(event.id)}
                      aria-label={`${event.date} ${event.name} ${event.isEstimated ? '예상' : '지급 확정'} 세후 ${formatMoney(event.netAmount, event.currency)}`}
                      title={`${event.dateLabel} ${event.date} · ${event.name} 세후 ${formatMoney(event.netAmount, event.currency)}`}
                      className={`w-full truncate rounded-md px-1.5 py-1 text-[11px] md:text-[12px] font-semibold text-left transition-all ${selectedCalendarEvent?.id === event.id ? 'bg-ink text-surface shadow-card' : event.isEstimated ? 'bg-brand-soft text-ink-soft hover:bg-line' : 'bg-up-soft text-up hover:brightness-95'}`}
                    >
                      {event.name}
                    </button>
                  ))}
                  {events.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setExpandedCalendarDate((previous) => (
                        previous === cell.dateKey ? '' : cell.dateKey
                      ))}
                      aria-expanded={expandedCalendarDate === cell.dateKey}
                      aria-label={`${cell.dateKey} 배당 일정 ${events.length - 3}건 더 보기`}
                      className={`block w-full rounded-md px-1 py-0.5 text-left text-[11px] font-bold transition-colors ${expandedCalendarDate === cell.dateKey ? 'bg-ink text-surface' : 'text-ink-mute hover:bg-canvas hover:text-ink'}`}
                    >
                      +{events.length - 3} 더보기
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {expandedCalendarEvents.length > 0 && (
          <div className="mt-4 md:mt-5 rounded-2xl border border-line bg-surface p-4 md:p-5 shadow-card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[11px] md:text-[12px] font-bold text-ink-mute">선택한 날짜의 전체 배당 일정</p>
                <h4 className="text-sm md:text-base font-bold text-ink mt-0.5">
                  {expandedCalendarDate} · {expandedCalendarEvents.length.toLocaleString()}건
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setExpandedCalendarDate('')}
                aria-label="날짜별 전체 일정 닫기"
                className="p-2 rounded-full bg-canvas text-ink-mute hover:text-ink transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {expandedCalendarEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedCalendarEventId(event.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${selectedCalendarEvent?.id === event.id ? 'border-ink bg-ink text-surface' : 'border-line-soft bg-canvas hover:border-line'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-xs md:text-sm truncate">{event.name}</p>
                      <p className={`text-[11px] font-semibold mt-1 ${selectedCalendarEvent?.id === event.id ? 'text-surface/70' : 'text-ink-mute'}`}>
                        {event.dateLabel} · {event.isEstimated ? '예상' : '확정'}
                      </p>
                    </div>
                    <span className={`figure shrink-0 text-xs md:text-sm font-bold ${selectedCalendarEvent?.id === event.id ? 'text-surface' : 'text-up'}`}>
                      {formatMoney(event.netAmount, event.currency)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 md:mt-6 bg-canvas rounded-2xl p-5 md:p-6">
          {selectedCalendarEvent ? (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-[12px] md:text-xs font-bold text-ink-mute mb-1">{selectedCalendarEvent.dateLabel} {selectedCalendarEvent.date}</p>
                <h4 className="text-lg md:text-xl font-bold text-ink">{selectedCalendarEvent.name}</h4>
                <p className="text-xs md:text-sm font-bold text-ink-soft mt-1">{selectedCalendarEvent.ticker} · {selectedCalendarEvent.quantity > 0 ? `${selectedCalendarEvent.quantity.toLocaleString()}주 기준` : '수량 미기록'}</p>
                <p className="text-[11px] md:text-xs font-bold text-ink-mute mt-1">
                  {selectedCalendarEvent.isEstimated ? '예상 배당기준일' : '배당기준일'} {selectedCalendarEvent.eligibilityDate || '미기록'}
                </p>
                <p className="text-[11px] md:text-xs font-bold text-ink-mute mt-1">
                  {selectedCalendarEvent.isEstimated ? `예상 지급일 ${selectedCalendarEvent.date}` : `배당지급일 ${selectedCalendarEvent.officialPaymentDate || '미기록'}`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 min-w-full md:min-w-80">
                <div className="bg-surface border border-line-soft rounded-xl p-4">
                  <p className="text-[12px] font-bold text-ink-mute mb-1">{selectedCalendarEvent.isEstimated ? '세전 예상' : '세전'}</p>
                  <p className="figure text-base md:text-lg font-bold text-ink">{selectedCalendarEvent.grossAmount > 0 ? formatMoney(selectedCalendarEvent.grossAmount, selectedCalendarEvent.currency) : '미기록'}</p>
                </div>
                <div className="bg-surface border border-line-soft rounded-xl p-4">
                  <p className="text-[12px] font-bold text-ink-mute mb-1">{selectedCalendarEvent.isEstimated ? '세후 예상' : '세후'}</p>
                  <p className="figure text-base md:text-lg font-bold text-up">{formatMoney(selectedCalendarEvent.netAmount, selectedCalendarEvent.currency)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs md:text-sm font-bold text-ink-mute">이번 달에 표시할 배당 일정이 없습니다.</p>
          )}
        </div>
      </div>
      )}
      </>
      ) : (
        <MarketCalendar
          month={calendarMonth}
          calendarCells={dividendCalendarCells}
          keywords={marketCalendarKeywords}
          onMonthChange={setCalendarMonth}
          onAddKeyword={addMarketCalendarKeyword}
          onRemoveKeyword={removeMarketCalendarKeyword}
        />
      )}
    </div>
    {calendarView === 'dividend' && (
      <AnnualDividendTrend
        year={annualDividendYear}
        selectedMonth={Number(calendarMonth.slice(5, 7))}
        trend={annualDividendTrend}
        isFxLoading={annualDividendFxLookupDates.length > 0}
        onYearChange={(year) => setCalendarMonth(`${year}-${calendarMonth.slice(5, 7)}`)}
        onMonthChange={(month) => setCalendarMonth(`${annualDividendYear}-${String(month).padStart(2, '0')}`)}
      />
    )}
    </div>
  );
};

export default CalendarTab;
