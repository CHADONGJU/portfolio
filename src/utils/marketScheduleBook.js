/*
 * 일정 제공처(TradingView)는 대략 한 달 앞까지만 데이터를 준다. 그래서 이미 공식
 * 발표된 확정 일정조차 두 달 뒤면 달력에서 사라진다. 여기에는 기관이 직접 공표해
 * 날짜가 확정된 일정만 적어 두고, 받아온 데이터에 없을 때만 채워 넣는다.
 *
 * 출처: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * (2026-08-19 갱신본 기준. 연준이 새 연도를 공표하면 이 표에 이어 붙이면 된다.)
 */

const ET_TIME_ZONE = 'America/New_York';
const FOMC_SOURCE = '연준 공식 일정표';
const FOMC_SOURCE_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

/** 회의 마지막 날. projections는 점도표(SEP)가 함께 나오는 회의. */
const FOMC_MEETINGS = [
  { date: '2026-09-16', projections: true },
  { date: '2026-10-28', projections: false },
  { date: '2026-12-09', projections: true },
  { date: '2027-01-27', projections: false },
  { date: '2027-03-17', projections: true },
  { date: '2027-04-28', projections: false },
  { date: '2027-06-09', projections: true },
  { date: '2027-07-28', projections: false },
  { date: '2027-09-15', projections: true },
  { date: '2027-10-27', projections: false },
  { date: '2027-12-08', projections: true },
  { date: '2028-01-26', projections: false },
];

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date).reduce((acc, { type, value }) => {
    acc[type] = value;
    return acc;
  }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
};

/*
 * FOMC 발표는 미 동부시간 오후 2시로 고정이지만 서머타임 때문에 UTC로는 18시와
 * 19시를 오간다. 손으로 적으면 12월·3월 회의에서 한 시간씩 틀리므로 계산한다.
 */
export const easternTimeToUtcIso = (dateKey, hour, minute = 0) => {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = naive - getTimeZoneOffsetMs(new Date(naive), ET_TIME_ZONE);
  const corrected = naive - getTimeZoneOffsetMs(new Date(firstGuess), ET_TIME_ZONE);
  return new Date(corrected).toISOString();
};

const buildFomcEvents = ({ date, projections }) => {
  const comment = 'FOMC(연방공개시장위원회) 정례회의에서 확정한 일정입니다. 연준이 미리 공표한 날짜라 변경될 가능성은 낮지만, 직전 회의에서 최종 확정됩니다.';
  const base = {
    country: 'US',
    category: 'Interest Rate',
    importance: 1,
    source: FOMC_SOURCE,
    sourceUrl: FOMC_SOURCE_URL,
    comment,
  };

  const events = [
    {
      ...base,
      id: `fomc-rate-${date}`,
      title: 'Fed Interest Rate Decision',
      indicator: 'FOMC Interest Rate Decision',
      date: easternTimeToUtcIso(date, 14),
    },
    {
      ...base,
      id: `fomc-press-${date}`,
      title: 'Fed Press Conference',
      indicator: 'FOMC Press Conference',
      date: easternTimeToUtcIso(date, 14, 30),
    },
  ];

  if (projections) {
    events.push({
      ...base,
      id: `fomc-projections-${date}`,
      title: 'FOMC Economic Projections',
      indicator: 'FOMC Economic Projections',
      date: easternTimeToUtcIso(date, 14),
    });
  }

  return events;
};

export const buildKnownMarketEvents = () => FOMC_MEETINGS.flatMap(buildFomcEvents);

const getDedupeKey = (event = {}) => [
  String(event.country || '').toUpperCase(),
  String(event.date || '').slice(0, 10),
  String(event.title || event.indicator || '').trim().toLocaleLowerCase(),
].join('|');

/**
 * 받아온 일정에 없는 확정 일정만 보탠다. 제공처가 같은 일정을 이미 주고 있으면
 * 실제값·예상치가 붙어 있는 그쪽을 남긴다.
 */
export const mergeKnownMarketEvents = (events = [], { from, to } = {}) => {
  const fetched = Array.isArray(events) ? events : [];
  const seen = new Set(fetched.map(getDedupeKey));
  const fromTime = from ? new Date(`${from}T00:00:00.000Z`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T00:00:00.000Z`).getTime() : Number.POSITIVE_INFINITY;

  const supplements = buildKnownMarketEvents().filter((event) => {
    const time = new Date(event.date).getTime();
    if (Number.isNaN(time) || time < fromTime || time >= toTime) return false;
    if (seen.has(getDedupeKey(event))) return false;
    seen.add(getDedupeKey(event));
    return true;
  });

  return [...fetched, ...supplements];
};
