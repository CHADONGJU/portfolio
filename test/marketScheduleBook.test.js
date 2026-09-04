import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKnownMarketEvents,
  easternTimeToUtcIso,
  mergeKnownMarketEvents,
} from '../src/utils/marketScheduleBook.js';
import { normalizeMarketCalendarEvents } from '../src/utils/marketCalendar.js';

test('FOMC 발표 시각은 서머타임을 따라 UTC가 바뀐다', () => {
  assert.equal(easternTimeToUtcIso('2027-06-09', 14), '2027-06-09T18:00:00.000Z');
  assert.equal(easternTimeToUtcIso('2026-12-09', 14), '2026-12-09T19:00:00.000Z');
  assert.equal(easternTimeToUtcIso('2026-12-09', 14, 30), '2026-12-09T19:30:00.000Z');
});

test('점도표가 없는 회의는 경제전망 일정을 만들지 않는다', () => {
  const events = buildKnownMarketEvents();
  const titlesOn = (dateKey) => events
    .filter((event) => event.date.startsWith(dateKey))
    .map(({ title }) => title)
    .sort();

  assert.deepEqual(titlesOn('2026-12-09'), [
    'FOMC Economic Projections',
    'Fed Interest Rate Decision',
    'Fed Press Conference',
  ]);
  assert.deepEqual(titlesOn('2026-10-28'), [
    'Fed Interest Rate Decision',
    'Fed Press Conference',
  ]);
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

test('조회 구간 밖의 확정 일정은 보태지 않는다', () => {
  const merged = mergeKnownMarketEvents([], { from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(merged, []);
});

test('제공처 데이터가 비어도 먼 미래 FOMC 일정을 한글로 보여준다', () => {
  const merged = mergeKnownMarketEvents([], { from: '2027-06-01', to: '2027-07-01' });
  const normalized = normalizeMarketCalendarEvents(merged, [{ keyword: '연준의장' }]);

  const pressConference = normalized.find(({ title }) => title === '연준 기자회견');
  assert.equal(pressConference.date, '2027-06-10');
  assert.equal(pressConference.timeLabel, '03:30');
  assert.equal(pressConference.countryLabel, '미국');
  assert.equal(pressConference.isKeywordMatch, true);
  assert.deepEqual(pressConference.matchedKeywords, ['연준의장']);
  assert.equal(pressConference.sourceUrl, 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');

  assert.ok(normalized.some(({ title }) => title === 'FOMC 기준금리 결정'));
  assert.ok(normalized.some(({ title }) => title === 'FOMC 경제전망(점도표)'));
});
