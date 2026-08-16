import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let throwOnGet = false;

globalThis.localStorage = {
  getItem: (key) => {
    if (throwOnGet) throw new Error('storage disabled');
    return store.has(key) ? store.get(key) : null;
  },
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

const {
  claimLegacyStorageKeys,
  getScopedStorageKey,
  loadJson,
  matchesFallbackShape,
  saveJson,
  setStorageErrorHandler,
} = await import('../src/utils/storage.js');

const reset = () => {
  store.clear();
  throwOnGet = false;
  setStorageErrorHandler(null);
};

test('저장된 null이 배열 기본값을 뚫고 상태로 들어가지 않는다', () => {
  reset();
  store.set('assets', 'null');
  // 예전에는 "null"이 truthy라 JSON.parse 결과 null이 그대로 반환됐고,
  // 첫 렌더의 .length에서 터지면서 화면이 하얘졌다.
  assert.deepEqual(loadJson('assets', []), []);
});

test('모양이 다른 값은 기본값으로 대체하고 사용자에게 알린다', () => {
  reset();
  const reported = [];
  setStorageErrorHandler((key, error, operation) => reported.push([key, operation]));

  store.set('assets', '{"not":"an array"}');
  assert.deepEqual(loadJson('assets', []), []);

  store.set('targetPortfolio', '[1,2,3]');
  assert.deepEqual(loadJson('targetPortfolio', { categories: [] }), { categories: [] });

  store.set('portfolioName', '42');
  assert.equal(loadJson('portfolioName', '내 포트폴리오'), '내 포트폴리오');

  assert.deepEqual(reported, [
    ['assets', 'read'],
    ['targetPortfolio', 'read'],
    ['portfolioName', 'read'],
  ]);
});

test('깨진 JSON은 값을 지우지 않고 기본값으로 시작한다', () => {
  reset();
  store.set('assets', '{broken');
  assert.deepEqual(loadJson('assets', []), []);
  // 사용자 데이터를 조용히 삭제하면 복구 자체가 불가능해진다.
  assert.equal(store.get('assets'), '{broken');
});

test('정상적인 값은 그대로 읽는다', () => {
  reset();
  saveJson('assets', [{ id: 1 }]);
  assert.deepEqual(loadJson('assets', []), [{ id: 1 }]);
  assert.equal(loadJson('missing', 'fallback'), 'fallback');
});

test('저장소를 쓸 수 없는 환경에서는 기본값으로 조용히 시작한다', () => {
  reset();
  throwOnGet = true;
  assert.deepEqual(loadJson('assets', []), []);
});

test('모양 검사 규칙', () => {
  assert.equal(matchesFallbackShape([], []), true);
  assert.equal(matchesFallbackShape(null, []), false);
  assert.equal(matchesFallbackShape({}, []), false);
  assert.equal(matchesFallbackShape([], {}), false);
  assert.equal(matchesFallbackShape(null, {}), false);
  assert.equal(matchesFallbackShape(0, 1), true);
  assert.equal(matchesFallbackShape('a', 1), false);
  assert.equal(matchesFallbackShape(false, true), true);
  // 기본값이 null이면 무엇이든 받는다.
  assert.equal(matchesFallbackShape({ any: 1 }, null), true);
});

test('계정별 키 분리와 기존 데이터 승계', () => {
  reset();
  assert.equal(getScopedStorageKey('portfolio_assets', 'uid-1'), 'portfolio_assets::uid-1');
  assert.equal(getScopedStorageKey('portfolio_assets', ''), 'portfolio_assets');

  store.set('portfolio_assets', '[{"id":1}]');
  assert.equal(claimLegacyStorageKeys(['portfolio_assets'], 'uid-1'), 1);
  assert.equal(store.get('portfolio_assets::uid-1'), '[{"id":1}]');
  assert.equal(store.has('portfolio_assets'), false);

  // 여러 번 호출해도 결과가 같아야 한다(StrictMode 이중 렌더).
  assert.equal(claimLegacyStorageKeys(['portfolio_assets'], 'uid-1'), 0);

  // 이미 그 계정의 값이 있으면 옛 키가 덮어쓰지 않는다.
  store.set('portfolio_assets', '[{"id":"legacy"}]');
  assert.equal(claimLegacyStorageKeys(['portfolio_assets'], 'uid-1'), 0);
  assert.equal(store.get('portfolio_assets::uid-1'), '[{"id":1}]');
});

test('다른 계정의 저장 영역은 서로 보이지 않는다', () => {
  reset();
  saveJson(getScopedStorageKey('portfolio_assets', 'uid-a'), [{ id: 'a' }]);
  assert.deepEqual(loadJson(getScopedStorageKey('portfolio_assets', 'uid-b'), []), []);
  assert.deepEqual(loadJson(getScopedStorageKey('portfolio_assets', 'guest'), []), []);
});
