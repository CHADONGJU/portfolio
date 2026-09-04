const KEYWORD_LIMIT = 20;

const KOREAN_KEYWORD_ALIASES = {
  잭슨홀: ['jackson hole', 'economic policy symposium'],
  연준: ['federal reserve', 'fed ', 'fomc'],
  /*
   * 의장 이름으로 검색하는 사람이 많은데 의장은 바뀐다. 이름 별칭은 그대로 두되
   * 직책으로 찾으면 누가 앉아 있든 기자회견이 걸리도록 별도 항목을 둔다.
   */
  연준의장: ['fed press conference', 'fed chair', 'fomc press conference'],
  의장: ['fed press conference', 'fed chair'],
  기자회견: ['press conference'],
  파월: ['powell'],
  워시: ['warsh'],
  점도표: ['economic projections', 'interest rate projection', 'dot plot'],
  금리: ['interest rate', 'rate decision', 'monetary policy'],
  물가: ['inflation', 'consumer price', 'producer price', 'cpi', 'pce', 'ppi'],
  고용: ['employment', 'payroll', 'unemployment', 'jobless', 'jolts'],
  한국은행: ['bank of korea', 'bok'],
  금통위: ['bank of korea', 'bok', '금융통화위원회'],
  유럽중앙은행: ['european central bank', 'ecb'],
  일본은행: ['bank of japan', 'boj'],
  /* 나라 이름으로 찾는 사람도 많다. 나라 코드로 넓혀 해당 시장 일정을 모두 건다. */
  미국: ['us'],
  한국: ['kr'],
  유럽: ['eu'],
  유로존: ['eu'],
  유럽연합: ['eu'],
  중국: ['cn'],
  일본: ['jp'],
};

const COUNTRY_LABELS = {
  US: '미국',
  KR: '한국',
  EU: '유로존',
  CN: '중국',
  JP: '일본',
};

/** 나라 선택 상자에 쓰는 목록. 워커가 받아오는 시장과 같은 순서로 둔다. */
export const MARKET_CALENDAR_COUNTRIES = Object.entries(COUNTRY_LABELS)
  .map(([code, label]) => ({ code, label }));

/* 나라 코드 대신 영문 이름으로 찾는 경우까지 받아 준다. */
const COUNTRY_NAME_TERMS = {
  US: ['usa', 'united states', 'america'],
  KR: ['korea', 'south korea'],
  EU: ['euro area', 'eurozone', 'european union'],
  CN: ['china'],
  JP: ['japan'],
};

const TITLE_TRANSLATIONS = [
  [/jackson hole|economic policy symposium/i, '잭슨홀 경제정책 심포지엄'],
  [/fomc.*minutes|minutes.*fomc/i, 'FOMC 회의록 공개'],
  [/(?:fed|fomc).*press conference/i, '연준 기자회견'],
  [/(?:ecb|european central bank).*press conference/i, 'ECB 기자회견'],
  [/fomc economic projections|interest rate projection/i, 'FOMC 경제전망(점도표)'],
  [/fed.*interest rate decision|fomc.*rate decision/i, 'FOMC 기준금리 결정'],
  [/bank of korea.*interest rate decision|bok.*rate decision/i, '한국은행 기준금리 결정'],
  [/european central bank.*interest rate decision|ecb.*rate decision/i, 'ECB 기준금리 결정'],
  [/bank of japan.*interest rate decision|boj.*rate decision/i, '일본은행 기준금리 결정'],
  [/non.?farm payrolls?/i, '비농업 고용'],
  [/jolts.*job openings?/i, 'JOLTS 구인건수'],
  [/unemployment rate/i, '실업률'],
  [/core pce price index/i, '근원 PCE 물가지수'],
  [/pce price index/i, 'PCE 물가지수'],
  [/core (?:consumer price index|inflation rate|cpi)/i, '근원 소비자물가'],
  [/consumer price index|\bcpi\b/i, '소비자물가지수(CPI)'],
  [/producer price index|\bppi\b/i, '생산자물가지수(PPI)'],
  [/inflation rate/i, '물가상승률'],
  [/gdp growth rate/i, 'GDP 성장률'],
  [/gross domestic product|\bgdp\b/i, '국내총생산(GDP)'],
  [/retail sales/i, '소매판매'],
  [/manufacturing pmi/i, '제조업 PMI'],
  [/services pmi/i, '서비스업 PMI'],
];

const normalizeText = (value = '') => String(value || '').trim().replace(/\s+/g, ' ');

const hashText = (value = '') => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const normalizeMarketCalendarKeyword = (value = '') => (
  normalizeText(value).slice(0, 40)
);
export const normalizeMarketCalendarKeywords = (rows = []) => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const keyword = normalizeMarketCalendarKeyword(
        typeof row === 'string' ? row : row?.keyword,
      );
      if (!keyword) return null;
      const normalized = keyword.toLocaleLowerCase('ko-KR');
      if (seen.has(normalized)) return null;
      seen.add(normalized);

      return {
        id: normalizeText(row?.id) || `market-keyword-${hashText(normalized)}`,
        keyword,
        createdAt: normalizeText(row?.createdAt),
      };
    })
    .filter(Boolean)
    .slice(0, KEYWORD_LIMIT);
};

export const createMarketCalendarKeyword = (value, createdAt = new Date().toISOString()) => {
  const keyword = normalizeMarketCalendarKeyword(value);
  if (!keyword) return null;
  return {
    id: `market-keyword-${hashText(keyword.toLocaleLowerCase('ko-KR'))}`,
    keyword,
    createdAt,
  };
};

/*
 * "연준 의장"처럼 띄어 쓰는 사람도 같은 별칭을 타야 한다. 별칭 표는 공백을 뺀
 * 형태로 한 번 만들어 두고 조회할 때도 공백을 뺀다.
 */
const ALIAS_LOOKUP = Object.entries(KOREAN_KEYWORD_ALIASES).reduce((lookup, [key, aliases]) => {
  lookup[key.replace(/\s+/g, '')] = aliases;
  return lookup;
}, {});

export const buildMarketCalendarSearchTerms = (keywordRows = []) => {
  const terms = new Set();
  normalizeMarketCalendarKeywords(keywordRows).forEach(({ keyword }) => {
    const normalized = keyword.toLocaleLowerCase('ko-KR');
    terms.add(normalized);
    (ALIAS_LOOKUP[normalized.replace(/\s+/g, '')] || []).forEach((alias) => terms.add(alias));
  });
  return [...terms];
};

const formatDatePart = (date, options) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  ...options,
}).format(date);

/*
 * 제공처는 한국 금통위 결정을 나라 코드만 붙여 "Interest Rate Decision"으로 준다.
 * 어느 중앙은행인지는 country에만 있으므로 번역할 때 힌트로 앞에 붙여 준다.
 */
const COUNTRY_BANK_HINTS = {
  US: 'fed',
  KR: 'bank of korea',
  EU: 'ecb',
  JP: 'bank of japan',
};

export const getKoreanMarketEventTitle = (event = {}) => {
  const original = normalizeText(event.title || event.indicator || event.name);
  const hint = COUNTRY_BANK_HINTS[String(event.country || '').toUpperCase()] || '';
  const searchable = `${hint} ${original} ${normalizeText(event.indicator)}`.trim();
  const translation = TITLE_TRANSLATIONS.find(([pattern]) => pattern.test(searchable));
  return translation?.[1] || original || '주요 증시 일정';
};

export const getMarketCountryLabel = (country = '') => (
  COUNTRY_LABELS[String(country || '').toUpperCase()] || String(country || '').toUpperCase() || '글로벌'
);

/*
 * "EU"나 "유럽"으로 찾으면 유로존 일정이 나와야 하는데 나라 코드는 본문 어디에도
 * 없다. 그래서 검색어를 나라와도 맞춰 본다.
 */
const buildCountryTerms = (country = '') => {
  const code = String(country || '').toUpperCase();
  return new Set([
    code.toLocaleLowerCase('ko-KR'),
    getMarketCountryLabel(code).toLocaleLowerCase('ko-KR'),
    ...(COUNTRY_NAME_TERMS[code] || []),
  ].filter(Boolean));
};

/*
 * us·eu 같은 두 글자 코드는 housing, euro처럼 흔한 단어에 그대로 들어 있다.
 * 본문 부분일치로 쓰면 온갖 일정이 걸리므로 나라 비교로만 쓴다.
 */
const COUNTRY_ONLY_TERM_PATTERN = /^[a-z]{1,2}$/;

const isMarketTermMatch = (term, searchable, countryTerms) => {
  if (countryTerms.has(term)) return true;
  if (COUNTRY_ONLY_TERM_PATTERN.test(term)) return false;
  return searchable.includes(term);
};

export const normalizeMarketCalendarEvent = (event = {}, keywordRows = []) => {
  const timestamp = new Date(event.date);
  if (Number.isNaN(timestamp.getTime())) return null;

  const terms = buildMarketCalendarSearchTerms(keywordRows);
  const countryTerms = buildCountryTerms(event.country);
  const searchable = [
    event.title,
    event.indicator,
    event.category,
    event.comment,
    event.source,
  ].map(normalizeText).join(' ').toLocaleLowerCase('ko-KR');
  const matchedKeywords = normalizeMarketCalendarKeywords(keywordRows)
    .filter(({ keyword }) => (
      buildMarketCalendarSearchTerms([{ keyword }])
        .some((term) => isMarketTermMatch(term, searchable, countryTerms))
    ))
    .map(({ keyword }) => keyword);

  return {
    id: `market-${event.id || hashText(`${event.date}-${event.title}`)}`,
    date: formatDatePart(timestamp, { year: 'numeric', month: '2-digit', day: '2-digit' }),
    timeLabel: formatDatePart(timestamp, { hour: '2-digit', minute: '2-digit', hour12: false }),
    timestamp: timestamp.toISOString(),
    title: getKoreanMarketEventTitle(event),
    originalTitle: normalizeText(event.title || event.indicator),
    country: String(event.country || '').toUpperCase(),
    countryLabel: getMarketCountryLabel(event.country),
    importance: Number(event.importance) || 0,
    actual: event.actual ?? null,
    previous: event.previous ?? null,
    forecast: event.forecast ?? null,
    unit: normalizeText(event.unit),
    scale: normalizeText(event.scale),
    currency: normalizeText(event.currency),
    source: normalizeText(event.source),
    sourceUrl: /^https?:\/\//i.test(String(event.sourceUrl || '')) ? event.sourceUrl : '',
    comment: normalizeText(event.comment),
    matchedKeywords,
    isKeywordMatch: matchedKeywords.length > 0
      || terms.some((term) => isMarketTermMatch(term, searchable, countryTerms)),
  };
};

export const normalizeMarketCalendarEvents = (events = [], keywordRows = []) => (
  (Array.isArray(events) ? events : [])
    .map((event) => normalizeMarketCalendarEvent(event, keywordRows))
    .filter(Boolean)
    .sort((left, right) => (
      left.timestamp.localeCompare(right.timestamp)
      || left.country.localeCompare(right.country)
      || left.title.localeCompare(right.title)
    ))
);

/** 나라를 고르지 않았으면 달력을 비워 둔다. 고르면 그 나라 일정만 남긴다. */
export const filterMarketCalendarEventsByCountry = (events = [], country = '') => {
  const code = String(country || '').toUpperCase();
  if (!code) return [];
  return (Array.isArray(events) ? events : [])
    .filter((event) => String(event?.country || '').toUpperCase() === code);
};

export const groupMarketCalendarEventsByDate = (events = []) => (
  events.reduce((grouped, event) => {
    if (!grouped[event.date]) grouped[event.date] = [];
    grouped[event.date].push(event);
    return grouped;
  }, {})
);
