/*
 * 일정 제공처(TradingView)는 대략 한 달 앞까지만 데이터를 준다. 그래서 이미 공식
 * 발표된 확정 일정조차 두 달 뒤면 달력에서 사라진다. 여기에는 중앙은행이 직접
 * 공표해 날짜가 확정된 회의만 적어 두고, 받아온 데이터에 없을 때만 채워 넣는다.
 *
 * 표의 날짜는 각 은행 공식 일정표에서 옮겼고(아래 sourceUrl), 발표 시각은 제공처가
 * 같은 일정에 쓰는 시각과 맞췄다. 새 연도가 공표되면 해당 배열에 이어 붙이면 된다.
 * 2026-09 기준으로 한국은행은 2027년 일정을 아직 공표하지 않았다.
 */

const SCHEDULE_SOURCES = {
  fed: {
    source: '연준 공식 일정표',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  ecb: {
    source: 'ECB 공식 일정표',
    sourceUrl: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html',
  },
  boj: {
    source: '일본은행 공식 일정표',
    sourceUrl: 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm',
  },
  bok: {
    source: '한국은행 공식 일정표',
    sourceUrl: 'https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755',
  },
};

/** 회의 마지막 날(= 결정 발표일). projections는 점도표(SEP)가 함께 나오는 회의. */
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

/** 정책이사회 통화정책회의 이틀째. 결정과 기자회견이 이날 나온다. */
const ECB_MEETINGS = [
  '2026-09-10', '2026-10-29', '2026-12-17',
  '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-10',
  '2027-07-22', '2027-09-09', '2027-10-28', '2027-12-16',
  '2028-02-03', '2028-03-23',
];

/** 금융정책결정회합 마지막 날. */
const BOJ_MEETINGS = [
  '2026-09-18', '2026-10-30', '2026-12-18',
  '2027-01-22', '2027-03-18', '2027-04-28', '2027-06-11',
  '2027-07-22', '2027-09-22', '2027-10-29', '2027-12-17',
];

/** 금융통화위원회 통화정책방향 결정회의. */
const BOK_MEETINGS = ['2026-10-22', '2026-11-26'];

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
 * 19시를 오간다. ECB도 마찬가지다. 손으로 적으면 12월·3월 회의에서 한 시간씩
 * 틀리므로 현지 시각만 적고 UTC는 계산한다.
 */
export const zonedTimeToUtcIso = (dateKey, timeZone, hour, minute = 0) => {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = naive - getTimeZoneOffsetMs(new Date(naive), timeZone);
  const corrected = naive - getTimeZoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected).toISOString();
};

const buildEvent = ({
  bank, id, title, date, timeZone, hour, minute = 0, comment, country, matchTitles = [],
}) => ({
  ...SCHEDULE_SOURCES[bank],
  id: `${bank}-${id}-${date}`,
  title,
  indicator: title,
  country,
  category: 'Interest Rate',
  importance: 1,
  comment,
  matchTitles: [title, ...matchTitles],
  date: zonedTimeToUtcIso(date, timeZone, hour, minute),
});

const FOMC_COMMENT = 'FOMC(연방공개시장위원회) 정례회의로 연준이 미리 공표한 일정입니다. 직전 회의에서 최종 확정됩니다.';
const ECB_COMMENT = 'ECB 정책이사회(Governing Council)의 통화정책회의 이틀째로, 기준금리 결정과 총재 기자회견이 이날 나옵니다.';
const BOJ_COMMENT = '일본은행(BoJ) 금융정책결정회합 마지막 날입니다. 발표 시각은 회의가 끝나는 시점에 따라 달라집니다.';
const BOK_COMMENT = '한국은행 금융통화위원회 통화정책방향 결정회의입니다. 결정문 발표 뒤 총재 기자간담회가 이어집니다.';

const buildFomcEvents = ({ date, projections }) => {
  const common = {
    bank: 'fed', date, country: 'US', timeZone: 'America/New_York', comment: FOMC_COMMENT,
  };
  const events = [
    { ...common, id: 'rate', title: 'Fed Interest Rate Decision', hour: 14 },
    { ...common, id: 'press', title: 'Fed Press Conference', hour: 14, minute: 30 },
  ];
  if (projections) {
    events.push({ ...common, id: 'projections', title: 'FOMC Economic Projections', hour: 14 });
  }
  return events.map(buildEvent);
};

const buildEcbEvents = (date) => {
  const common = {
    bank: 'ecb', date, country: 'EU', timeZone: 'Europe/Berlin', comment: ECB_COMMENT,
  };
  return [
    { ...common, id: 'rate', title: 'ECB Interest Rate Decision', hour: 14, minute: 15 },
    { ...common, id: 'press', title: 'ECB Press Conference', hour: 14, minute: 45 },
  ].map(buildEvent);
};

const buildBojEvents = (date) => [buildEvent({
  bank: 'boj',
  date,
  id: 'rate',
  title: 'BoJ Interest Rate Decision',
  country: 'JP',
  timeZone: 'Asia/Tokyo',
  hour: 12,
  comment: BOJ_COMMENT,
})];

const buildBokEvents = (date) => [buildEvent({
  bank: 'bok',
  date,
  id: 'rate',
  title: 'BoK Interest Rate Decision',
  country: 'KR',
  timeZone: 'Asia/Seoul',
  hour: 10,
  comment: BOK_COMMENT,
  // 제공처는 한국 일정을 나라 코드만 붙여 "Interest Rate Decision"으로 준다.
  matchTitles: ['Interest Rate Decision'],
})];

export const buildKnownMarketEvents = () => [
  ...FOMC_MEETINGS.flatMap(buildFomcEvents),
  ...ECB_MEETINGS.flatMap(buildEcbEvents),
  ...BOJ_MEETINGS.flatMap(buildBojEvents),
  ...BOK_MEETINGS.flatMap(buildBokEvents),
];

/** matchTitles는 중복 판정에만 쓰는 내부 필드라 달력으로 내보내지 않는다. */
const toCalendarEvent = (event) => {
  const calendarEvent = { ...event };
  delete calendarEvent.matchTitles;
  return calendarEvent;
};

const getDedupeKey = (country, date, title) => [
  String(country || '').toUpperCase(),
  String(date || '').slice(0, 10),
  String(title || '').trim().toLocaleLowerCase(),
].join('|');

/**
 * 받아온 일정에 없는 확정 일정만 보탠다. 제공처가 같은 일정을 이미 주고 있으면
 * 실제값·예상치가 붙어 있는 그쪽을 남긴다.
 */
export const mergeKnownMarketEvents = (events = [], { from, to } = {}) => {
  const fetched = Array.isArray(events) ? events : [];
  const seen = new Set(fetched.map((event) => (
    getDedupeKey(event.country, event.date, event.title || event.indicator)
  )));
  const fromTime = from ? new Date(`${from}T00:00:00.000Z`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T00:00:00.000Z`).getTime() : Number.POSITIVE_INFINITY;

  const supplements = buildKnownMarketEvents().filter((event) => {
    const time = new Date(event.date).getTime();
    if (Number.isNaN(time) || time < fromTime || time >= toTime) return false;

    const keys = event.matchTitles.map((title) => getDedupeKey(event.country, event.date, title));
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  }).map(toCalendarEvent);

  return [...fetched, ...supplements];
};
