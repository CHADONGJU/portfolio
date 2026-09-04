const TRADING_VIEW_CALENDAR_URL = 'https://economic-calendar.tradingview.com/events';
const ALLOWED_COUNTRIES = ['US', 'KR', 'EU', 'CN', 'JP'];
const MAX_RANGE_DAYS = 370;
const UPSTREAM_TIMEOUT_MS = 20_000;

const KEYWORD_MAX_LENGTH = 80;

const normalizeSearchText = (value = '') => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase();

/*
 * 키워드는 길이를 자르지만, 비교 대상인 일정 본문까지 자르면 안 된다.
 * comment는 300자를 넘는 일이 흔해서 앞부분만 보면 FOMC 같은 키워드가
 * 열 건 중 한 건만 걸린다.
 */
const normalizeKeyword = (value = '') => normalizeSearchText(value).slice(0, KEYWORD_MAX_LENGTH);

const parseDateKey = (value = '') => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};
export const getCalendarRequest = (requestUrl) => {
  const url = new URL(requestUrl);
  const from = parseDateKey(url.searchParams.get('from'));
  const to = parseDateKey(url.searchParams.get('to'));
  if (!from || !to || to <= from) return null;

  const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (rangeDays > MAX_RANGE_DAYS) return null;

  const keywords = [...new Set(
    url.searchParams.getAll('keyword').map(normalizeKeyword).filter(Boolean),
  )].slice(0, 32);

  return {
    from,
    to,
    keywords,
    keywordsOnly: url.searchParams.get('keywordsOnly') === '1',
  };
};

const isKeywordMatch = (event, keywords) => {
  if (keywords.length === 0) return false;
  const searchable = [
    event?.title,
    event?.indicator,
    event?.category,
    event?.comment,
    event?.source,
  ].map(normalizeSearchText).join(' ');
  return keywords.some((keyword) => searchable.includes(keyword));
};

const cleanText = (value, maxLength = 200) => String(value || '').trim().slice(0, maxLength);

export const filterMarketCalendarEvents = (events, { keywords, keywordsOnly }) => (
  (Array.isArray(events) ? events : [])
    .filter((event) => {
      const keywordMatch = isKeywordMatch(event, keywords);
      return keywordsOnly ? keywordMatch : Number(event?.importance) >= 1 || keywordMatch;
    })
    .map((event) => ({
      id: cleanText(event.id, 80),
      title: cleanText(event.title || event.indicator, 160),
      indicator: cleanText(event.indicator, 160),
      country: cleanText(event.country, 8),
      category: cleanText(event.category, 40),
      comment: cleanText(event.comment, 800),
      date: cleanText(event.date, 40),
      source: cleanText(event.source, 160),
      sourceUrl: /^https?:\/\//i.test(String(event.source_url || ''))
        ? cleanText(event.source_url, 300)
        : '',
      actual: event.actual ?? null,
      previous: event.previous ?? null,
      forecast: event.forecast ?? null,
      unit: cleanText(event.unit, 20),
      scale: cleanText(event.scale, 12),
      currency: cleanText(event.currency, 12),
      importance: Number(event.importance) || 0,
    }))
);

export const fetchMarketCalendarEvents = async (requestConfig) => {
  const upstreamUrl = new URL(TRADING_VIEW_CALENDAR_URL);
  upstreamUrl.searchParams.set('from', requestConfig.from.toISOString());
  upstreamUrl.searchParams.set('to', requestConfig.to.toISOString());
  upstreamUrl.searchParams.set('countries', ALLOWED_COUNTRIES.join(','));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/economic-calendar/',
        'User-Agent': 'Mozilla/5.0 (compatible; my-portfolio-calendar/1.0)',
      },
      cf: { cacheEverything: true, cacheTtl: 900 },
    });
    if (!response.ok) throw new Error(`calendar upstream responded ${response.status}`);
    const payload = await response.json();
    return filterMarketCalendarEvents(payload?.result, requestConfig);
  } finally {
    clearTimeout(timeoutId);
  }
};
