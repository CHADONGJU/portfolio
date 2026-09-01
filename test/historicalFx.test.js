import assert from 'node:assert/strict';
import test from 'node:test';

import { getHistoricalFxRate } from '../src/services/historicalFx.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

test('KRW는 외부 API 없이 1을 사용한다', async () => {
  let calls = 0;
  const result = await getHistoricalFxRate('KRW', 'KRW', '2026-09-01', {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  assert.equal(result.rate, 1);
  assert.equal(result.rateDate, '2026-09-01');
  assert.equal(result.source, 'BASE_CURRENCY');
  assert.equal(calls, 0);
});

test('영업일 환율과 공급자 날짜를 함께 반환한다', async () => {
  const result = await getHistoricalFxRate('USD', 'KRW', '2026-09-01', {
    fetchImpl: async () => jsonResponse({ date: '2026-09-01', rates: { KRW: 1350.25 } }),
  });

  assert.deepEqual(result, {
    currency: 'USD',
    baseCurrency: 'KRW',
    requestedDate: '2026-09-01',
    rateDate: '2026-09-01',
    rate: 1350.25,
    source: 'FRANKFURTER_ECB',
  });
});

test('휴일 요청에 이전 공식 영업일이 반환되면 그 날짜를 보존한다', async () => {
  const result = await getHistoricalFxRate('USD', 'KRW', '2026-09-06', {
    fetchImpl: async () => jsonResponse({ date: '2026-09-04', rates: { KRW: 1342.5 } }),
  });

  assert.equal(result.requestedDate, '2026-09-06');
  assert.equal(result.rateDate, '2026-09-04');
  assert.equal(result.rate, 1342.5);
});

test('제공자 실패 뒤 이전 날짜까지 조회하고 미래 환율은 거부한다', async () => {
  const urls = [];
  const result = await getHistoricalFxRate('USD', 'KRW', '2026-09-06', {
    maxLookbackDays: 2,
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('2026-09-05') && url.includes('frankfurter')) {
        return jsonResponse({ date: '2026-09-05', rates: { KRW: 1330 } });
      }
      if (url.includes('2026-09-06') && url.includes('frankfurter')) {
        return jsonResponse({ date: '2026-09-07', rates: { KRW: 9999 } });
      }
      return jsonResponse({}, 404);
    },
  });

  assert.equal(result.rateDate, '2026-09-05');
  assert.equal(result.rate, 1330);
  assert.ok(urls.some((url) => url.includes('2026-09-05')));
});

test('모든 공급자가 실패하면 임의 환율을 만들지 않는다', async () => {
  const result = await getHistoricalFxRate('USD', 'KRW', '2026-09-01', {
    maxLookbackDays: 1,
    fetchImpl: async () => jsonResponse({}, 503),
  });
  assert.equal(result, null);
});

test('subrequest 예산을 넘어 환율 공급자를 추가 호출하지 않는다', async () => {
  let calls = 0;
  const requestBudget = { remaining: 1 };
  const result = await getHistoricalFxRate('USD', 'KRW', '2026-09-01', {
    requestBudget,
    maxLookbackDays: 3,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({}, 503);
    },
  });

  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.equal(requestBudget.remaining, 0);
});
