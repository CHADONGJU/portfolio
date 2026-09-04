import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterMarketCalendarEvents,
  getCalendarRequest,
} from '../worker/src/marketCalendar.js';

test('일정 프록시는 최대 1년의 올바른 날짜 범위만 허용한다', () => {
  const valid = getCalendarRequest(
    'https://worker.example/api/market-calendar?from=2026-09-01&to=2027-09-01&keyword=jackson%20hole&keywordsOnly=1',
  );
  assert.equal(valid.from.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(valid.to.toISOString(), '2027-09-01T00:00:00.000Z');
  assert.deepEqual(valid.keywords, ['jackson hole']);
  assert.equal(valid.keywordsOnly, true);

  assert.equal(getCalendarRequest(
    'https://worker.example/api/market-calendar?from=2026-09-01&to=2027-09-07',
  ), null);
  assert.equal(getCalendarRequest(
    'https://worker.example/api/market-calendar?from=not-a-date&to=2026-10-01',
  ), null);
});
test('기본 달력은 중요 일정만, 키워드 전용 조회는 일치하는 일정만 반환한다', () => {
  const rawEvents = [
    { id: 'high', title: 'Fed Interest Rate Decision', importance: 1, date: '2026-09-16T18:00:00Z' },
    { id: 'low', title: 'Wholesale Inventories', importance: -1, date: '2026-09-10T14:00:00Z' },
    { id: 'keyword', title: 'Jackson Hole Economic Policy Symposium', importance: 0, date: '2026-08-27T15:00:00Z' },
  ];

  const calendarEvents = filterMarketCalendarEvents(rawEvents, {
    keywords: ['jackson hole'],
    keywordsOnly: false,
  });
  assert.deepEqual(calendarEvents.map(({ id }) => id), ['high', 'keyword']);

  const keywordEvents = filterMarketCalendarEvents(rawEvents, {
    keywords: ['jackson hole'],
    keywordsOnly: true,
  });
  assert.deepEqual(keywordEvents.map(({ id }) => id), ['keyword']);
});

test('일정 본문 뒷부분에 있는 키워드도 놓치지 않는다', () => {
  const longComment = `${'The Federal Reserve publishes a detailed statement after every meeting. '.repeat(6)}The FOMC decision is announced at 2pm.`;
  const rawEvents = [
    {
      id: 'fed-projection',
      title: 'Interest Rate Projection - Longer',
      comment: longComment,
      importance: 0,
      date: '2026-09-16T18:00:00Z',
    },
  ];

  assert.ok(longComment.indexOf('FOMC') > 80, '키워드가 80자 뒤에 있어야 의미 있는 검증이다');
  const keywordEvents = filterMarketCalendarEvents(rawEvents, {
    keywords: ['fomc'],
    keywordsOnly: true,
  });
  assert.deepEqual(keywordEvents.map(({ id }) => id), ['fed-projection']);
});

test('한국 기준금리 결정은 제공처 중요도가 낮아도 기본 달력에 남긴다', () => {
  const rawEvents = [
    { id: 'bok', title: 'Interest Rate Decision', country: 'KR', importance: 0, date: '2026-10-22T01:00:00Z' },
    { id: 'kr-minor', title: 'Consumer Confidence', country: 'KR', importance: 0, date: '2026-10-27T21:00:00Z' },
    { id: 'jp-minor', title: 'Interest Rate Decision', country: 'JP', importance: 0, date: '2026-10-30T03:00:00Z' },
  ];

  const calendarEvents = filterMarketCalendarEvents(rawEvents, { keywords: [], keywordsOnly: false });
  assert.deepEqual(calendarEvents.map(({ id }) => id), ['bok']);
  assert.equal(calendarEvents[0].importance, 1);
});
