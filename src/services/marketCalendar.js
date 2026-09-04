const SERVICE_URL = import.meta.env.VITE_AI_PROXY_URL || '';
const REQUEST_TIMEOUT_MS = 20_000;

export class MarketCalendarError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MarketCalendarError';
    this.code = code;
  }
}

export const isMarketCalendarConfigured = Boolean(SERVICE_URL);

export const fetchMarketCalendar = async ({
  from,
  to,
  searchTerms = [],
  keywordsOnly = false,
  signal,
}) => {
  if (!SERVICE_URL) {
    throw new MarketCalendarError('주요 증시 일정 서비스가 아직 연결되지 않았습니다.', 'not-configured');
  }

  const url = new URL(`${SERVICE_URL.replace(/\/$/, '')}/api/market-calendar`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  if (keywordsOnly) url.searchParams.set('keywordsOnly', '1');
  searchTerms.slice(0, 32).forEach((term) => url.searchParams.append('keyword', term));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller);

  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new MarketCalendarError(
        data?.message || '주요 증시 일정을 가져오지 못했습니다.',
        data?.error || `http-${response.status}`,
      );
    }
    return Array.isArray(data.events) ? data.events : [];
  } catch (error) {
    if (error instanceof MarketCalendarError) throw error;
    if (error?.name === 'AbortError') {
      throw new MarketCalendarError('일정 조회 시간이 초과되었습니다.', 'aborted');
    }
    throw new MarketCalendarError('네트워크 오류로 일정을 가져오지 못했습니다.', 'network');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
};
