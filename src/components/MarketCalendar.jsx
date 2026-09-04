import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Plus, RotateCw, X } from 'lucide-react';
import { fetchMarketCalendar } from '../services/marketCalendar';
import {
  buildMarketCalendarSearchTerms,
  groupMarketCalendarEventsByDate,
  normalizeMarketCalendarEvents,
} from '../utils/marketCalendar';
import { mergeKnownMarketEvents } from '../utils/marketScheduleBook';

const formatDateKey = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const getNextMonthKey = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return formatDateKey(new Date(year, monthNumber, 1));
};

const getFutureRange = () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setFullYear(to.getFullYear() + 1);
  return { from: formatDateKey(from), to: formatDateKey(to) };
};

const formatMetric = (value, event) => {
  if (value === null || value === undefined || value === '') return '-';
  const suffix = `${event.scale || ''}${event.unit || ''}`;
  return `${value}${suffix}`;
};

const dedupeEvents = (events = []) => {
  const seen = new Set();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
};

const EventButton = ({ event, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={`${event.countryLabel} · ${event.originalTitle} · 한국시간 ${event.timeLabel}`}
    className={`w-full truncate rounded-md px-1.5 py-1 text-[11px] md:text-[12px] font-semibold text-left transition-all ${
      selected
        ? 'bg-ink text-surface shadow-card'
        : event.isKeywordMatch
          ? 'bg-warn-soft text-warn hover:brightness-95'
          : 'bg-brand-soft text-brand-strong hover:brightness-95'
    }`}
  >
    <span className="mr-1 opacity-70">{event.country}</span>
    {event.title}
  </button>
);

const MarketCalendar = ({
  month,
  calendarCells,
  keywords,
  onMonthChange,
  onAddKeyword,
  onRemoveKeyword,
}) => {
  const [keywordInput, setKeywordInput] = useState('');
  const [monthEvents, setMonthEvents] = useState([]);
  const [futureKeywordEvents, setFutureKeywordEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [expandedDate, setExpandedDate] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isFutureLoading, setIsFutureLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [futureErrorMessage, setFutureErrorMessage] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const searchTerms = useMemo(() => buildMarketCalendarSearchTerms(keywords), [keywords]);
  const searchKey = searchTerms.join('|');

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage('');
    const range = { from: `${month}-01`, to: getNextMonthKey(month) };
    fetchMarketCalendar({
      ...range,
      searchTerms,
      signal: controller.signal,
    }).then((events) => {
      const normalized = normalizeMarketCalendarEvents(
        mergeKnownMarketEvents(events, range),
        keywords,
      );
      setMonthEvents(normalized);
      setSelectedEvent((previous) => (
        normalized.find((event) => event.id === previous?.id) || normalized[0] || null
      ));
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setMonthEvents([]);
      setSelectedEvent(null);
      setErrorMessage(error?.message || '주요 증시 일정을 가져오지 못했습니다.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  // searchKey는 키워드 배열을 안정적인 문자열로 바꾼 의존성이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, searchKey, reloadToken]);

  useEffect(() => {
    if (searchTerms.length === 0) {
      setFutureKeywordEvents([]);
      setFutureErrorMessage('');
      setIsFutureLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const range = getFutureRange();
    setIsFutureLoading(true);
    setFutureErrorMessage('');
    fetchMarketCalendar({
      ...range,
      searchTerms,
      keywordsOnly: true,
      signal: controller.signal,
    }).then((events) => {
      const normalized = normalizeMarketCalendarEvents(
        mergeKnownMarketEvents(events, range),
        keywords,
      ).filter((event) => event.isKeywordMatch);
      setFutureKeywordEvents(dedupeEvents(normalized));
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setFutureKeywordEvents([]);
      setFutureErrorMessage(error?.message || '관심 키워드 일정을 찾지 못했습니다.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsFutureLoading(false);
    });
    return () => controller.abort();
  // searchKey는 키워드 배열을 안정적인 문자열로 바꾼 의존성이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, reloadToken]);

  const eventsByDate = useMemo(() => groupMarketCalendarEventsByDate(monthEvents), [monthEvents]);
  const expandedEvents = expandedDate ? (eventsByDate[expandedDate] || []) : [];
  const countryCount = new Set(monthEvents.map((event) => event.country)).size;
  const importantEventCount = monthEvents.filter((event) => event.importance >= 1).length;
  const keywordMatchCount = monthEvents.filter((event) => event.isKeywordMatch).length;

  useEffect(() => {
    if (expandedDate && !eventsByDate[expandedDate]) setExpandedDate('');
  }, [eventsByDate, expandedDate]);

  const handleKeywordSubmit = (event) => {
    event.preventDefault();
    const keyword = keywordInput.trim();
    if (!keyword) return;
    onAddKeyword(keyword);
    setKeywordInput('');
  };

  const selectFutureEvent = (event) => {
    setSelectedEvent(event);
    onMonthChange(event.date.slice(0, 7));
  };

  return (
    <>
      <div className="px-5 py-4 md:px-7 md:py-5 border-b border-line bg-canvas/60">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div>
            <p className="text-[12px] md:text-xs font-bold text-ink-mute">
              {month.replace('-', '년 ')}월 주요 증시 일정
            </p>
            <p className="text-[11px] md:text-[12px] font-semibold text-ink-mute mt-1">
              중요도 높음 {importantEventCount}건 · 관심 키워드 {keywordMatchCount}건 · {countryCount || 0}개 시장
            </p>
          </div>
          <form onSubmit={handleKeywordSubmit} className="flex w-full xl:w-auto gap-2">
            <label htmlFor="market-calendar-keyword" className="sr-only">관심 일정 키워드</label>
            <input
              id="market-calendar-keyword"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              maxLength={40}
              placeholder="예: FOMC, 금리, 물가, 연준의장"
              className="min-w-0 flex-1 xl:w-64 rounded-xl border border-line bg-surface px-3 py-2 text-xs md:text-sm font-semibold text-ink placeholder:text-ink-mute"
            />
            <button
              type="submit"
              disabled={!keywordInput.trim() || keywords.length >= 20}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-xs md:text-sm font-bold text-surface disabled:opacity-40"
            >
              <Plus size={15} /> 키워드 추가
            </button>
          </form>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {keywords.length > 0 ? keywords.map((entry) => (
            <span key={entry.id} className="inline-flex items-center gap-1.5 rounded-full border border-warn/20 bg-warn-soft px-3 py-1.5 text-[11px] md:text-xs font-bold text-warn">
              {entry.keyword}
              <button
                type="button"
                onClick={() => onRemoveKeyword(entry.id)}
                aria-label={`${entry.keyword} 키워드 삭제`}
                className="rounded-full p-0.5 hover:bg-warn/10"
              >
                <X size={13} />
              </button>
            </span>
          )) : (
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute">
              관심 키워드를 추가하면 기본 중요도와 관계없이 일정을 찾아 표시합니다.
            </p>
          )}
        </div>

        {keywords.length > 0 && (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[11px] font-bold text-ink-mute">향후 1년 관심 키워드 일정</p>
                <p className="text-xs md:text-sm font-bold text-ink mt-0.5">
                  {isFutureLoading ? '관련 일정을 찾는 중…' : `${futureKeywordEvents.length.toLocaleString()}건 발견`}
                </p>
              </div>
              {futureErrorMessage && (
                <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="text-xs font-bold text-brand">
                  다시 조회
                </button>
              )}
            </div>
            {futureErrorMessage ? (
              <p className="text-xs font-semibold text-danger">{futureErrorMessage}</p>
            ) : !isFutureLoading && futureKeywordEvents.length === 0 ? (
              <p className="text-xs font-semibold text-ink-mute">
                일정 제공처가 대략 한 달 앞까지만 데이터를 공개합니다. 그보다 먼 구간은
                FOMC처럼 기관이 날짜를 미리 확정 공표한 일정만 표시되고, 나머지는 공개되는
                대로 이 달력을 열 때 자동으로 반영됩니다.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto scroll-soft pb-1">
                {futureKeywordEvents.slice(0, 12).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => selectFutureEvent(event)}
                    className="min-w-48 rounded-xl border border-line-soft bg-canvas px-3 py-2.5 text-left hover:border-warn/30"
                  >
                    <p className="text-[11px] font-bold text-warn">{event.date} · {event.timeLabel}</p>
                    <p className="mt-1 truncate text-xs font-bold text-ink">{event.country} {event.title}</p>
                    <p className="mt-1 truncate text-[11px] font-semibold text-ink-mute">{event.matchedKeywords.join(', ')}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 md:p-7">
        <div className="grid grid-cols-7 gap-1.5 md:gap-2 mb-2">
          {['일', '월', '화', '수', '목', '금', '토'].map((weekday, weekdayIndex) => (
            <div
              key={weekday}
              className={`text-center text-[11px] md:text-[12px] font-bold tracking-[0.06em] py-2 ${weekdayIndex === 0 ? 'text-up/70' : weekdayIndex === 6 ? 'text-down/70' : 'text-ink-mute'}`}
            >
              {weekday}
            </div>
          ))}
        </div>

        {errorMessage ? (
          <div className="min-h-72 rounded-2xl border border-danger/20 bg-danger-soft/40 grid place-items-center p-6 text-center">
            <div>
              <p className="text-sm font-bold text-danger">{errorMessage}</p>
              <button
                type="button"
                onClick={() => setReloadToken((value) => value + 1)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-xs font-bold text-ink"
              >
                <RotateCw size={14} /> 다시 조회
              </button>
            </div>
          </div>
        ) : (
          <div className={`grid grid-cols-7 gap-1.5 md:gap-2 ${isLoading ? 'opacity-50' : ''}`} aria-busy={isLoading}>
            {calendarCells.map((cell) => {
              const events = eventsByDate[cell.dateKey] || [];
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
                      <EventButton
                        key={event.id}
                        event={event}
                        selected={selectedEvent?.id === event.id}
                        onClick={() => setSelectedEvent(event)}
                      />
                    ))}
                    {events.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setExpandedDate((previous) => previous === cell.dateKey ? '' : cell.dateKey)}
                        aria-expanded={expandedDate === cell.dateKey}
                        className={`block w-full rounded-md px-1 py-0.5 text-left text-[11px] font-bold transition-colors ${expandedDate === cell.dateKey ? 'bg-ink text-surface' : 'text-ink-mute hover:bg-canvas hover:text-ink'}`}
                      >
                        +{events.length - 3} 더보기
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {expandedEvents.length > 0 && (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4 md:p-5 shadow-card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[11px] font-bold text-ink-mute">선택한 날짜의 전체 증시 일정</p>
                <h4 className="text-sm md:text-base font-bold text-ink mt-0.5">{expandedDate} · {expandedEvents.length}건</h4>
              </div>
              <button type="button" onClick={() => setExpandedDate('')} aria-label="전체 일정 닫기" className="p-2 rounded-full bg-canvas text-ink-mute hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {expandedEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedEvent(event)}
                  className={`rounded-xl border p-3 text-left ${selectedEvent?.id === event.id ? 'border-ink bg-ink text-surface' : 'border-line-soft bg-canvas'}`}
                >
                  <p className="text-xs font-bold truncate">{event.countryLabel} · {event.title}</p>
                  <p className={`mt-1 text-[11px] font-semibold ${selectedEvent?.id === event.id ? 'text-surface/70' : 'text-ink-mute'}`}>{event.timeLabel} · 한국시간</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 md:mt-6 bg-canvas rounded-2xl p-5 md:p-6">
          {selectedEvent ? (
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-ink-mute mb-1">
                  {selectedEvent.countryLabel} · {selectedEvent.date} {selectedEvent.timeLabel} (한국시간)
                </p>
                <h4 className="text-lg md:text-xl font-bold text-ink">{selectedEvent.title}</h4>
                {selectedEvent.originalTitle !== selectedEvent.title && (
                  <p className="mt-1 text-xs font-semibold text-ink-mute">{selectedEvent.originalTitle}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {selectedEvent.matchedKeywords.map((keyword) => (
                    <span key={keyword} className="rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-bold text-warn">관심 · {keyword}</span>
                  ))}
                  {selectedEvent.source && (
                    selectedEvent.sourceUrl ? (
                      <a href={selectedEvent.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline">
                        {selectedEvent.source} <ExternalLink size={12} />
                      </a>
                    ) : <span className="text-[11px] font-semibold text-ink-mute">출처 · {selectedEvent.source}</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 min-w-full xl:min-w-96">
                {[
                  ['실제', selectedEvent.actual],
                  ['예상', selectedEvent.forecast],
                  ['이전', selectedEvent.previous],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface border border-line-soft rounded-xl p-3 md:p-4">
                    <p className="text-[11px] font-bold text-ink-mute mb-1">{label}</p>
                    <p className="figure text-sm md:text-base font-bold text-ink">{formatMetric(value, selectedEvent)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-center text-xs md:text-sm font-bold text-ink-mute">
              {isLoading ? '주요 증시 일정을 불러오는 중입니다.' : '이번 달에 표시할 주요 일정이 없습니다.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
};

export default MarketCalendar;
