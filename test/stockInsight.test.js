import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStockInsightPayload, canSummarizeAsset } from '../src/utils/stockInsightPayload.js';
import { buildInsightMessages, normalizeAssetContext, MAX_QUESTION_LENGTH } from '../worker/src/prompt.js';
import { consumeQuota, getQuotaDay, getQuotaKey, getSecondsUntilReset, refundQuota } from '../worker/src/quota.js';

const sampleAsset = {
  id: 'a1',
  name: '삼성전자',
  ticker: '005930',
  category: '국내주식',
  currency: 'KRW',
  originalCurrency: 'KRW',
  quantity: 30,
  nativeAveragePrice: 62000,
  nativeCurrentPrice: 71000,
  returnPercent: 14.516,
  displayBuyDate: '2024-03-11',
  // 화면 계산용 파생 필드. 프록시로 새어 나가면 안 된다.
  currentKRW: 2130000,
  purchaseKRW: 1860000,
  profitKRW: 270000,
};

test('AI 요약 payload는 종목 식별과 맥락 필드만 담는다', () => {
  const payload = buildStockInsightPayload(sampleAsset);

  assert.deepEqual(Object.keys(payload).sort(), [
    'averagePrice', 'buyDate', 'category', 'currency', 'currentPrice', 'name', 'quantity', 'returnPercent', 'ticker',
  ]);
  assert.equal(payload.name, '삼성전자');
  assert.equal(payload.averagePrice, 62000);
  assert.equal(payload.currentPrice, 71000);
});

test('금액 절대값은 payload에 포함하지 않는다', () => {
  const payload = buildStockInsightPayload(sampleAsset);
  const serialized = JSON.stringify(payload);

  assert.equal(serialized.includes('2130000'), false);
  assert.equal(serialized.includes('1860000'), false);
  assert.equal(serialized.includes('270000'), false);
});

test('해외 종목은 현지 통화 기준 단가를 쓴다', () => {
  const payload = buildStockInsightPayload({
    name: 'Apple',
    ticker: 'AAPL',
    originalCurrency: 'usd',
    quantity: 5,
    originalAveragePrice: 180.25,
    nativeCurrentPrice: 210.4,
    returnPercent: 16.7,
  });

  assert.equal(payload.currency, 'USD');
  assert.equal(payload.averagePrice, 180.25);
  assert.equal(payload.currentPrice, 210.4);
});

test('이름이 없으면 payload를 만들지 않는다', () => {
  assert.equal(buildStockInsightPayload({ name: '  ' }), null);
  assert.equal(buildStockInsightPayload(null), null);
});

test('현금 자산에는 AI 요약 버튼을 붙이지 않는다', () => {
  assert.equal(canSummarizeAsset({ name: '예수금', category: '현금' }), false);
  assert.equal(canSummarizeAsset(sampleAsset), true);
});

test('프록시는 신뢰할 수 없는 필드를 잘라내고 정규화한다', () => {
  const normalized = normalizeAssetContext({
    name: `${'가'.repeat(200)}`,
    ticker: '005930',
    currency: 'krw',
    quantity: 'not-a-number',
    role: 'system',
  });

  assert.equal(normalized.name.length, 80);
  assert.equal(normalized.currency, 'KRW');
  assert.ok(Number.isNaN(normalized.quantity));
  assert.equal('role' in normalized, false);
});

test('질문이 없으면 기본 분석 항목을 요청한다', () => {
  const messages = buildInsightMessages(normalizeAssetContext(sampleAsset), '');

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.includes('매수/매도 추천'));
  assert.ok(messages[0].content.includes('한국어로만'));
  assert.ok(messages[0].content.includes('생각 과정'));
  assert.ok(messages[1].content.includes('삼성전자'));
  assert.ok(messages[1].content.includes('리스크'));
});

test('질문은 최대 길이로 잘라서 넣는다', () => {
  const longQuestion = 'ㄱ'.repeat(MAX_QUESTION_LENGTH + 50);
  const messages = buildInsightMessages(normalizeAssetContext(sampleAsset), longQuestion);

  assert.ok(messages[1].content.includes('질문: '));
  assert.equal(messages[1].content.includes('ㄱ'.repeat(MAX_QUESTION_LENGTH + 1)), false);
});

test('일일 한도 키는 KST 자정을 기준으로 바뀐다', () => {
  // 2026-08-27 14:59 UTC = 2026-08-27 23:59 KST
  const beforeMidnight = Date.parse('2026-08-27T14:59:00Z');
  // 2026-08-27 15:01 UTC = 2026-08-28 00:01 KST
  const afterMidnight = Date.parse('2026-08-27T15:01:00Z');

  assert.equal(getQuotaDay(beforeMidnight), '2026-08-27');
  assert.equal(getQuotaDay(afterMidnight), '2026-08-28');
  assert.equal(getQuotaKey('uid-1', afterMidnight), 'q:uid-1:2026-08-28');
  assert.ok(getSecondsUntilReset(beforeMidnight) <= 60);
});

const createMemoryKv = () => {
  const store = new Map();
  return {
    store,
    get: async (key) => (store.has(key) ? store.get(key) : null),
    put: async (key, value) => { store.set(key, value); },
  };
};

test('한도에 도달하면 더 통과시키지 않는다', async () => {
  const kv = createMemoryKv();
  const now = Date.parse('2026-08-27T01:00:00Z');

  const first = await consumeQuota(kv, 'uid-1', 2, now);
  const second = await consumeQuota(kv, 'uid-1', 2, now);
  const third = await consumeQuota(kv, 'uid-1', 2, now);

  assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);
  assert.equal(second.remaining, 0);
  assert.equal(third.remaining, 0);
});

test('사용량은 사용자별로 따로 센다', async () => {
  const kv = createMemoryKv();
  const now = Date.parse('2026-08-27T01:00:00Z');

  await consumeQuota(kv, 'uid-1', 1, now);
  const otherUser = await consumeQuota(kv, 'uid-2', 1, now);

  assert.equal(otherUser.allowed, true);
});

test('KV 바인딩이 없으면 한도를 걸지 않고 통과시킨다', async () => {
  const result = await consumeQuota(undefined, 'uid-1', 5);
  assert.equal(result.allowed, true);
});

test('영어 사고 과정 서두는 잘라내고 한국어 본문만 남긴다', async () => {
  const { stripReasoningPreamble } = await import('../worker/src/prompt.js');

  const leaked = [
    "Here's a thinking process:",
    '1. Analyze User Input:',
    '* Stock: Samsung Electronics',
    '',
    '삼성전자는 반도체와 스마트폰을 주력으로 하는 회사입니다.',
    '- 메모리 업황이 실적을 좌우합니다.',
  ].join('\n');

  assert.equal(
    stripReasoningPreamble(leaked),
    '삼성전자는 반도체와 스마트폰을 주력으로 하는 회사입니다.\n- 메모리 업황이 실적을 좌우합니다.',
  );
});

test('정상 한국어 응답은 그대로 통과시킨다', async () => {
  const { stripReasoningPreamble } = await import('../worker/src/prompt.js');

  const clean = '삼성전자는 반도체를 만듭니다.\n\n- 리스크는 업황 변동입니다.';
  assert.equal(stripReasoningPreamble(clean), clean);
});

test('한국어가 전혀 없으면 원문을 보존한다', async () => {
  const { stripReasoningPreamble } = await import('../worker/src/prompt.js');

  const englishOnly = "Here's a thinking process:\nI cannot answer this.";
  assert.equal(stripReasoningPreamble(englishOnly), englishOnly);
});

test('빈 응답에도 터지지 않는다', async () => {
  const { stripReasoningPreamble } = await import('../worker/src/prompt.js');

  assert.equal(stripReasoningPreamble(''), '');
  assert.equal(stripReasoningPreamble(null), '');
  assert.equal(stripReasoningPreamble(undefined), '');
});

test('실패한 호출은 환불해서 한도를 되돌린다', async () => {
  const kv = createMemoryKv();
  const now = Date.parse('2026-08-27T01:00:00Z');

  await consumeQuota(kv, 'uid-1', 3, now);
  await consumeQuota(kv, 'uid-1', 3, now);
  await refundQuota(kv, 'uid-1', now);

  const next = await consumeQuota(kv, 'uid-1', 3, now);
  assert.equal(next.used, 2);
  assert.equal(next.remaining, 1);
});

test('환불로 사용량이 음수가 되지는 않는다', async () => {
  const kv = createMemoryKv();
  const now = Date.parse('2026-08-27T01:00:00Z');

  await refundQuota(kv, 'uid-1', now);
  await refundQuota(kv, 'uid-1', now);

  const first = await consumeQuota(kv, 'uid-1', 2, now);
  assert.equal(first.used, 1);
});

test('한도를 다 쓴 뒤 환불하면 다시 한 번 쓸 수 있다', async () => {
  const kv = createMemoryKv();
  const now = Date.parse('2026-08-27T01:00:00Z');

  await consumeQuota(kv, 'uid-1', 1, now);
  const blocked = await consumeQuota(kv, 'uid-1', 1, now);
  assert.equal(blocked.allowed, false);

  await refundQuota(kv, 'uid-1', now);
  const retry = await consumeQuota(kv, 'uid-1', 1, now);
  assert.equal(retry.allowed, true);
});

test('KV 바인딩이 없으면 환불도 조용히 넘어간다', async () => {
  await refundQuota(undefined, 'uid-1');
});
