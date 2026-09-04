import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketCalendarSearchTerms,
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
