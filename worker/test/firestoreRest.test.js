import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitPortfolioSnapshots,
  decodeFirestoreFields,
  encodeFirestoreFields,
  getPortfolioUserId,
  listPortfolioRoots,
  queryCollectionGroup,
} from '../src/firestoreRest.js';

test('Firestore REST typed value를 왕복한다', () => {
  const input = {
    text: 'value', count: 3, ratio: 1.5, enabled: true, missing: null,
    rows: [{ currency: 'USD', rate: 1350 }],
  };
  assert.deepEqual(decodeFirestoreFields(encodeFirestoreFields(input)), input);
});

test('문서 경로에서 portfolio user id를 읽는다', () => {
  assert.equal(getPortfolioUserId(
    'projects/demo/databases/(default)/documents/portfolioStates/user-1/assets/asset-1',
  ), 'user-1');
});

test('루트 목록을 페이지 처리하고 collection group 문서를 해석한다', async () => {
  let rootPage = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith(':runQuery')) {
      assert.equal(init.method, 'POST');
      return new Response(JSON.stringify([{ document: {
        name: 'projects/demo/databases/(default)/documents/portfolioStates/user-1/assets/asset-1',
        fields: encodeFirestoreFields({ ticker: 'AAPL', quantity: 2 }),
      } }]), { status: 200 });
    }
    rootPage += 1;
    return new Response(JSON.stringify(rootPage === 1 ? {
      documents: [{
        name: 'projects/demo/databases/(default)/documents/portfolioStates/user-1',
        fields: encodeFirestoreFields({ joinedAt: '2026-08-28' }),
      }],
      nextPageToken: 'next',
    } : { documents: [] }), { status: 200 });
  };

  const roots = await listPortfolioRoots({ projectId: 'demo', accessToken: 'token', fetchImpl });
  const assets = await queryCollectionGroup({
    projectId: 'demo', accessToken: 'token', collectionId: 'assets', fetchImpl,
  });
  assert.equal(roots.length, 1);
  assert.equal(rootPage, 2);
  assert.equal(assets[0].data.ticker, 'AAPL');
});

test('snapshot-{date} 고정 문서 ID로 commit write를 만든다', async () => {
  let requestBody;
  const committed = await commitPortfolioSnapshots({
    projectId: 'demo',
    accessToken: 'token',
    snapshots: [{
      userId: 'user-1',
      id: 'snapshot-2026-08-27',
      data: { date: '2026-08-27', valueKRW: 1234, includesCash: true },
    }],
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    },
  });

  assert.equal(committed, 1);
  assert.match(requestBody.writes[0].update.name, /portfolioSnapshots\/snapshot-2026-08-27$/);
  assert.equal(requestBody.writes[0].update.fields.valueKRW.integerValue, '1234');
});

test('INCOMPLETE Snapshot만 collection group에서 조회할 수 있다', async () => {
  let requestBody;
  await queryCollectionGroup({
    projectId: 'demo-project',
    accessToken: 'token',
    collectionId: 'portfolioSnapshots',
    whereFieldPath: 'status',
    whereValue: 'incomplete',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify([]), { status: 200 });
    },
  });

  assert.deepEqual(requestBody.structuredQuery.where, {
    fieldFilter: {
      field: { fieldPath: 'status' },
      op: 'EQUAL',
      value: { stringValue: 'incomplete' },
    },
  });
});
