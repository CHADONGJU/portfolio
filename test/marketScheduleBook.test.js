import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKnownMarketEvents,
  mergeKnownMarketEvents,
  zonedTimeToUtcIso,
} from '../src/utils/marketScheduleBook.js';
import { normalizeMarketCalendarEvents } from '../src/utils/marketCalendar.js';

const findEvent = (events, title) => events.find((event) => event.title === title);

test('현지 시각을 서머타임까지 반영해 UTC로 바꾼다', () => {
  assert.equal(zonedTimeToUtcIso('2027-06-09', 'America/New_York', 14), '2027-06-09T18:00:00.000Z');
  assert.equal(zonedTimeToUtcIso('2026-12-09', 'America/New_York', 14), '2026-12-09T19:00:00.000Z');
  assert.equal(zonedTimeToUtcIso('2026-09-10', 'Europe/Berlin', 14, 15), '2026-09-10T12:15:00.000Z');
  assert.equal(zonedTimeToUtcIso('2026-12-17', 'Europe/Berlin', 14, 15), '2026-12-17T13:15:00.000Z');
  // 일본·한국은 서머타임이 없어 연중 같은 오프셋이다.
  assert.equal(zonedTimeToUtcIso('2026-09-18', 'Asia/Tokyo', 12), '2026-09-18T03:00:00.000Z');
  assert.equal(zonedTimeToUtcIso('2026-10-22', 'Asia/Seoul', 10), '2026-10-22T01:00:00.000Z');
});

test('네 중앙은행의 확정 일정을 모두 담는다', () => {
  const events = buildKnownMarketEvents();
  const countries = new Set(events.map(({ country }) => country));
  assert.deepEqual([...countries].sort(), ['EU', 'JP', 'KR', 'US']);

  const onDate = (dateKey) => events
    .filter((event) => event.date.startsWith(dateKey))
    .map(({ title }) => title)
    .sort();

  assert.deepEqual(onDate('2026-12-09'), [
    'FOMC Economic Projections',
    'Fed Interest Rate Decision',
    'Fed Press Conference',
  ]);
  // 점도표가 없는 회의는 경제전망 일정을 만들지 않는다.
  assert.deepEqual(onDate('2026-10-28'), ['Fed Interest Rate Decision', 'Fed Press Conference']);
  assert.deepEqual(onDate('2026-12-17'), ['ECB Interest Rate Decision', 'ECB Press Conference']);
  assert.deepEqual(onDate('2026-09-18'), ['BoJ Interest Rate Decision']);
  assert.deepEqual(onDate('2026-10-22'), ['BoK Interest Rate Decision']);
});

test('제공처가 이미 준 일정은 확정 일정으로 덮어쓰지 않는다', () => {
  const fetched = [{
    id: 'upstream-1',
    title: 'Fed Interest Rate Decision',
    country: 'US',
    date: '2026-12-09T19:00:00.000Z',
    importance: 1,
    actual: '3.5%',
  }];

  const merged = mergeKnownMarketEvents(fetched, { from: '2026-12-01', to: '2027-01-01' });
  const decisions = merged.filter(({ title }) => title === 'Fed Interest Rate Decision');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].id, 'upstream-1');
  assert.ok(merged.some(({ title }) => title === 'Fed Press Conference'));
});

test('제목이 달라도 같은 한국은행 결정이면 중복으로 넣지 않는다', () => {
  const fetched = [{
    id: 'upstream-kr',
    title: 'Interest Rate Decision',
    country: 'KR',
    date: '2026-10-22T01:00:00.000Z',
    importance: 0,
  }];

  const merged = mergeKnownMarketEvents(fetched, { from: '2026-10-01', to: '2026-11-01' });
  assert.equal(merged.filter(({ country }) => country === 'KR').length, 1);
});

test('조회 구간 밖의 확정 일정은 보태지 않는다', () => {
  assert.deepEqual(mergeKnownMarketEvents([], { from: '2026-11-01', to: '2026-11-20' }), []);
});

test('제공처 데이터가 비어도 먼 미래 일정을 한글 제목으로 보여준다', () => {
  const merged = mergeKnownMarketEvents([], { from: '2027-06-01', to: '2027-07-01' });
  const normalized = normalizeMarketCalendarEvents(merged, [{ keyword: '연준의장' }]);

  const pressConference = findEvent(normalized, '연준 기자회견');
  assert.equal(pressConference.date, '2027-06-10');
  assert.equal(pressConference.timeLabel, '03:30');
  assert.equal(pressConference.countryLabel, '미국');
  assert.equal(pressConference.isKeywordMatch, true);
  assert.deepEqual(pressConference.matchedKeywords, ['연준의장']);
  assert.equal(pressConference.sourceUrl, 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');

  assert.ok(findEvent(normalized, 'FOMC 기준금리 결정'));
  assert.ok(findEvent(normalized, 'FOMC 경제전망(점도표)'));
  assert.ok(findEvent(normalized, 'ECB 기준금리 결정'));
  assert.ok(findEvent(normalized, 'ECB 기자회견'));
  assert.ok(findEvent(normalized, '일본은행 기준금리 결정'));
});

test('금통위 키워드로 한국은행 확정 일정을 찾는다', () => {
  const merged = mergeKnownMarketEvents([], { from: '2026-10-01', to: '2026-12-01' });
  const matched = normalizeMarketCalendarEvents(merged, [{ keyword: '금통위' }])
    .filter((event) => event.isKeywordMatch);

  assert.deepEqual(matched.map(({ date }) => date), ['2026-10-22', '2026-11-26']);
  assert.equal(matched[0].title, '한국은행 기준금리 결정');
  assert.equal(matched[0].timeLabel, '10:00');
});
