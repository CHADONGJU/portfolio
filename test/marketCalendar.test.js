import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKET_CALENDAR_COUNTRIES,
  buildMarketCalendarSearchTerms,
  filterMarketCalendarEventsByCountry,
  createMarketCalendarKeyword,
  groupMarketCalendarEventsByDate,
  normalizeMarketCalendarEvent,
  normalizeMarketCalendarKeywords,
} from '../src/utils/marketCalendar.js';

test('관심 키워드는 중복 없이 저장하고 잭슨홀 한글 입력을 영문 검색어로 확장한다', () => {
  const rows = normalizeMarketCalendarKeywords([
    createMarketCalendarKeyword(' 잭슨홀 '),
    { id: 'duplicate', keyword: '잭슨홀' },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].keyword, '잭슨홀');
  assert.deepEqual(
    buildMarketCalendarSearchTerms(rows),
    ['잭슨홀', 'jackson hole', 'economic policy symposium'],
  );
});
test('영문 잭슨홀 일정을 한국시간 날짜와 한글 제목으로 정규화한다', () => {
  const event = normalizeMarketCalendarEvent({
    id: 'jackson-hole-2026',
    title: 'Jackson Hole Economic Policy Symposium',
    country: 'US',
    date: '2026-08-27T15:00:00.000Z',
    importance: 0,
  }, [{ id: 'keyword-1', keyword: '잭슨홀' }]);

  assert.equal(event.date, '2026-08-28');
  assert.equal(event.timeLabel, '00:00');
  assert.equal(event.title, '잭슨홀 경제정책 심포지엄');
  assert.equal(event.isKeywordMatch, true);
  assert.deepEqual(event.matchedKeywords, ['잭슨홀']);
});

test('일정은 한국시간 날짜 기준으로 묶는다', () => {
  const grouped = groupMarketCalendarEventsByDate([
    { id: 'one', date: '2026-09-11' },
    { id: 'two', date: '2026-09-11' },
    { id: 'three', date: '2026-09-16' },
  ]);

  assert.deepEqual(grouped['2026-09-11'].map(({ id }) => id), ['one', 'two']);
  assert.deepEqual(grouped['2026-09-16'].map(({ id }) => id), ['three']);
});

test('띄어 쓴 "연준 의장"도 기자회견 검색어로 확장한다', () => {
  assert.deepEqual(
    buildMarketCalendarSearchTerms([{ id: 'k1', keyword: '연준 의장' }]),
    ['연준 의장', 'fed press conference', 'fed chair', 'fomc press conference'],
  );
});

test('중앙은행 이름이 빠진 제목도 나라를 보고 한글로 옮긴다', () => {
  const event = normalizeMarketCalendarEvent({
    id: 'bok-2026-10',
    title: 'Interest Rate Decision',
    country: 'KR',
    date: '2026-10-22T01:00:00.000Z',
    importance: 1,
  }, []);

  assert.equal(event.title, '한국은행 기준금리 결정');
  assert.equal(event.originalTitle, 'Interest Rate Decision');
  assert.equal(event.date, '2026-10-22');
  assert.equal(event.timeLabel, '10:00');
});

test('나라 코드와 나라 이름으로도 해당 시장 일정을 찾는다', () => {
  const ecbEvent = {
    id: 'ecb-2026-09',
    title: 'ECB Interest Rate Decision',
    country: 'EU',
    date: '2026-09-10T12:15:00.000Z',
    importance: 1,
  };

  assert.equal(normalizeMarketCalendarEvent(ecbEvent, [{ id: 'k1', keyword: 'EU' }]).isKeywordMatch, true);
  assert.deepEqual(
    normalizeMarketCalendarEvent(ecbEvent, [{ id: 'k2', keyword: '유럽' }]).matchedKeywords,
    ['유럽'],
  );
  assert.deepEqual(
    normalizeMarketCalendarEvent(ecbEvent, [{ id: 'k3', keyword: '유로존' }]).matchedKeywords,
    ['유로존'],
  );
});

test('두 글자 나라 코드는 본문 부분일치로 다른 나라 일정을 끌어오지 않는다', () => {
  const usHousing = normalizeMarketCalendarEvent({
    id: 'us-housing',
    title: 'Housing Starts',
    country: 'US',
    date: '2026-09-17T12:30:00.000Z',
    importance: 1,
  }, [{ id: 'k1', keyword: 'EU' }]);

  assert.equal(usHousing.isKeywordMatch, false);
  assert.deepEqual(usHousing.matchedKeywords, []);
});

test('나라를 고르기 전에는 달력을 비우고, 고르면 그 나라 일정만 남긴다', () => {
  const events = [
    { id: 'us', country: 'US' },
    { id: 'eu', country: 'EU' },
    { id: 'kr', country: 'KR' },
  ];

  assert.deepEqual(filterMarketCalendarEventsByCountry(events, ''), []);
  assert.deepEqual(
    filterMarketCalendarEventsByCountry(events, 'eu').map(({ id }) => id),
    ['eu'],
  );
  assert.deepEqual(MARKET_CALENDAR_COUNTRIES.map(({ code }) => code), ['US', 'KR', 'EU', 'CN', 'JP']);
});
