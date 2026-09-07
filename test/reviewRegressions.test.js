import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionFromTradeRows } from '../src/utils/tradeReconciliation.js';
import { editBuyLot, resolveBuyLotFxRate } from '../src/utils/buyLotEditing.js';
import { fetchBufferedResponse } from '../src/utils/network.js';
import { fetchMarketCalendar } from '../src/services/marketCalendar.js';
import { buildMarketCalendarSearchTerms } from '../src/utils/marketCalendar.js';
import { getCalendarRequest } from '../worker/src/marketCalendar.js';
import { PORTFOLIO_CURRENCIES, resolveManualTradeAsset } from '../src/utils/currencies.js';

test('same-day sale before additional purchase preserves average cost and realized gains', () => {
  const base = { name: 'Test', ticker: 'TEST', currency: 'KRW', fxRate: 1 };
  const rows = [
    { ...base, id: 'buy-1', side: 'buy', date: '2026-09-01', quantity: 10, price: 100, createdAt: '2026-09-01T00:00:00Z' },
    { ...base, id: 'trade-2', side: 'sell', date: '2026-09-02', quantity: 5, price: 150, pnl: 250, createdAt: '2026-09-02T01:00:00Z' },
    { ...base, id: 'buy-3', side: 'buy', date: '2026-09-02', quantity: 5, price: 200, createdAt: '2026-09-02T02:00:00Z' },
  ];
  for (const input of [rows, [...rows].reverse(), [rows[2], rows[0], rows[1]]]) {
    const result = buildPositionFromTradeRows(input, { resolveKrwRate: (row) => row.fxRate });
    assert.equal(result.quantity, 10);
    assert.equal(result.averagePrice, 150);
    assert.equal(result.krwCost, 1500);
    assert.equal(result.rows.find((row) => row.side === 'sell').krwPnl, 250);
  }
});

test('buy date changes never inherit the previous date FX rate, even before lookup completes', () => {
  const original = { date: '2026-08-01', quantity: 10, fxRate: 1300 };
  const edited = editBuyLot(original, 'date', '2026-08-02');
  assert.equal(edited.fxRate, 0);
  assert.equal(resolveBuyLotFxRate({ lot: edited, existingRow: original, currency: 'USD', lookedUpRate: 1400 }), 1400);
  assert.equal(resolveBuyLotFxRate({ lot: edited, existingRow: original, currency: 'USD', lookedUpRate: 0 }), 0);
  assert.equal(resolveBuyLotFxRate({ lot: editBuyLot(original, 'quantity', 20), existingRow: original, currency: 'USD', lookedUpRate: 1400 }), 1300);
});

test('successful headers with a stalled body still time out and allow later requests', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start() {} }));
  });
  await assert.rejects(fetchBufferedResponse('https://example.test/stalled', {}, 15), { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ price: 42 }));
  const response = await fetchBufferedResponse('https://example.test/next', {}, 1000);
  assert.deepEqual(await response.json(), { price: 42 });
});

test('already-cancelled requests do not start a network call', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchBufferedResponse('https://example.test', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('calendar includes first-day KST dawn and excludes next-month dawn', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url.searchParams.get('from'), '2026-08-31');
    assert.equal(url.searchParams.get('to'), '2026-10-01');
    assert.ok(getCalendarRequest(url.toString()));
    return Response.json({ events: [
      { id: 'before', date: '2026-08-31T14:59:59Z' },
      { id: 'midnight', date: '2026-08-31T15:00:00Z' },
      { id: 'dawn', date: '2026-08-31T18:00:00Z' },
      { id: 'last', date: '2026-09-30T14:59:59Z' },
      { id: 'next', date: '2026-09-30T15:00:00Z' },
    ] });
  });
  const events = await fetchMarketCalendar({ from: '2026-09-01', to: '2026-10-01', serviceUrl: 'https://worker.test' });
  assert.deepEqual(events.map((event) => event.id), ['midnight', 'dawn', 'last']);
});

test('all expanded calendar keywords reach even an older 32-term worker', async (t) => {
  const searchTerms = buildMarketCalendarSearchTerms(['잭슨홀', '연준', '연준의장', '의장', '기자회견', '점도표', '금리', '물가', '고용', '한국은행', '유럽중앙은행', '일본은행', '중국']);
  assert.ok(searchTerms.length > 32);
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const terms = url.searchParams.getAll('keyword');
    assert.ok(terms.length <= 32);
    assert.equal(url.searchParams.get('keywordsOnly'), '1');
    sent.push(...getCalendarRequest(url.toString()).keywords);
    return Response.json({ events: [{ id: 'same', date: '2026-09-01T00:00:00Z' }] });
  });
  const events = await fetchMarketCalendar({ from: '2026-09-01', to: '2027-09-01', searchTerms, keywordsOnly: true, serviceUrl: 'https://worker.test' });
  assert.deepEqual(sent.sort(), searchTerms.map((term) => term.trim().toLowerCase()).sort());
  assert.equal(events.length, 1);
});

test('worker rejects impossible calendar dates instead of silently rolling over', () => {
  assert.equal(getCalendarRequest('https://worker.test/?from=2026-02-30&to=2026-04-01'), null);
});

test('JPY is available for historical trades and an explicit ticker wins over a same-name holding', () => {
  assert.ok(PORTFOLIO_CURRENCIES.some(({ value }) => value === 'JPY'));
  const assets = [{ name: 'Stock', ticker: 'US', currency: 'USD' }, { name: 'Stock', ticker: '7203.T', currency: 'JPY' }];
  assert.equal(resolveManualTradeAsset({ stockName: 'Stock', ticker: '7203.T' }, assets).currency, 'JPY');
  assert.equal(resolveManualTradeAsset({ stockName: 'Stock', ticker: '6758.T' }, assets), undefined);
});
