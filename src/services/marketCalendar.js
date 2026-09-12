// 주요 증시 일정 조회 클라이언트.
// 프록시 워커를 통해 일정을 받아온다. 실패해도 앱이 멈추지 않도록 오류를
// 유형으로 구분해 돌려준다.
import { koreanDateStart } from '../utils/dates.js';
import { fetchBufferedResponse } from '../utils/network.js';

const SERVICE_URL = import.meta.env?.VITE_AI_PROXY_URL || '';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TERMS_PER_REQUEST = 32;

export class MarketCalendarError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MarketCalendarError';
    this.code = code;
  }
}

export const fetchMarketCalendar = async ({ from, to, searchTerms = [], keywordsOnly = false, signal, serviceUrl = SERVICE_URL }) => {
  if (!serviceUrl) throw new MarketCalendarError('주요 증시 일정 서비스가 아직 연결되지 않았습니다.', 'not-configured');
  const start = koreanDateStart(from);
  const end = koreanDateStart(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new MarketCalendarError('조회 날짜를 확인해 주세요.', 'bad-request');
  }
  // UTC date-only bounds cover the Korean days on both old and new workers.
  const fromUtc = start.toISOString().slice(0, 10);
  const toUtc = new Date(Math.ceil(end.getTime() / 86400000) * 86400000).toISOString().slice(0, 10);
  const terms = [...new Set(searchTerms.filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < terms.length; index += MAX_TERMS_PER_REQUEST) {
    chunks.push(terms.slice(index, index + MAX_TERMS_PER_REQUEST));
  }
  if (chunks.length === 0) chunks.push([]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const batches = await Promise.all(chunks.map(async (chunk) => {
      const url = new URL(`${serviceUrl.replace(/\/$/, '')}/api/market-calendar`);
      url.searchParams.set('from', fromUtc);
      url.searchParams.set('to', toUtc);
      if (keywordsOnly) url.searchParams.set('keywordsOnly', '1');
      chunk.forEach((term) => url.searchParams.append('keyword', term));
      const response = await fetchBufferedResponse(url, { signal: controller.signal, cache: 'no-store' }, REQUEST_TIMEOUT_MS);
      const data = await response.json();
      if (!response.ok) throw new MarketCalendarError(data?.message || '주요 증시 일정을 가져오지 못했습니다.', data?.error || `http-${response.status}`);
      return Array.isArray(data.events) ? data.events : [];
    }));
    const unique = new Map();
    batches.flat().forEach((event) => {
      const time = Date.parse(event.date);
      if (!Number.isFinite(time) || time < start.getTime() || time >= end.getTime()) return;
      const key = event.id || `${event.country}|${event.date}|${event.title}`;
      unique.set(key, event);
    });
    return [...unique.values()];
  } catch (error) {
    controller.abort();
    if (error instanceof MarketCalendarError) throw error;
    if (error?.name === 'AbortError') throw new MarketCalendarError('일정 조회 시간이 초과되었거나 취소되었습니다.', 'aborted');
    throw new MarketCalendarError('네트워크 오류로 일정을 가져오지 못했습니다.', 'network');
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};
