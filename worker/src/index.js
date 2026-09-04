import { verifyFirebaseIdToken } from './firebaseAuth.js';
import { consumeQuota, getSecondsUntilReset, refundQuota } from './quota.js';
import { fetchMarketCalendarEvents, getCalendarRequest } from './marketCalendar.js';
import { buildInsightMessages, normalizeAssetContext, stripReasoningPreamble } from './prompt.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODELS = 'z-ai/glm-5.2:free,minimax/minimax-m3:free';
const DEFAULT_DAILY_LIMIT = 20;
const UPSTREAM_TIMEOUT_MS = 45_000;

const parseList = (value, fallback) => String(value || fallback)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/**
 * 허용 오리진은 화이트리스트로만 연다. `*`로 열면 아무 사이트나 내 키로
 * 요청을 흘려보낼 수 있다(로그인 토큰이 필요하긴 하지만 굳이 열어 둘 이유가 없다).
 */
const corsHeaders = (request, env) => {
  const origin = request.headers.get('Origin') || '';
  const allowed = parseList(env.ALLOWED_ORIGINS, '');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};

const json = (body, status, request, env) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
});

const handleMarketCalendar = async (request, env) => {
  const requestConfig = getCalendarRequest(request.url);
  if (!requestConfig) {
    return json({
      error: 'bad-request',
      message: '조회 기간은 올바른 날짜로 최대 1년까지 지정해 주세요.',
    }, 400, request, env);
  }

  try {
    const events = await fetchMarketCalendarEvents(requestConfig);
    return new Response(JSON.stringify({ events, fetchedAt: new Date().toISOString() }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        ...corsHeaders(request, env),
      },
    });
  } catch (error) {
    console.log('market-calendar-error', error?.message || error);
    return json({
      error: error?.name === 'AbortError' ? 'timeout' : 'upstream-failed',
      message: '일정 제공처에서 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    }, 502, request, env);
  }
};

const handleInsight = async (request, env) => {
  /*
   * 붙여넣기로 시크릿을 넣으면 끝에 개행이 딸려 들어가는 일이 잦다. 그 값을 그대로
   * 헤더에 쓰면 헤더가 통째로 무효가 되어 빠지고, OpenRouter는 키가 틀렸다가 아니라
   * "인증 헤더가 없다"고 답한다. 원인을 짐작하기 어려운 실패라 여기서 잘라낸다.
   */
  const apiKey = String(env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return json({ error: 'server-misconfigured' }, 500, request, env);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const identity = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  if (!identity) {
    return json({ error: 'unauthorized', message: '로그인이 필요합니다.' }, 401, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad-request' }, 400, request, env);
  }

  const asset = normalizeAssetContext(payload?.asset);
  if (!asset) {
    return json({ error: 'bad-request', message: '종목 정보가 없습니다.' }, 400, request, env);
  }

  const limit = Number(env.DAILY_LIMIT) > 0 ? Number(env.DAILY_LIMIT) : DEFAULT_DAILY_LIMIT;
  const quota = await consumeQuota(env.AI_QUOTA, identity.uid, limit);
  if (!quota.allowed) {
    return json({
      error: 'quota-exceeded',
      message: `오늘 사용할 수 있는 AI 요약 ${limit}회를 모두 썼습니다. 자정에 초기화됩니다.`,
      resetInSeconds: getSecondsUntilReset(),
    }, 429, request, env);
  }

  const models = parseList(env.AI_MODELS, DEFAULT_MODELS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter 대시보드에서 어느 앱이 얼마를 썼는지 구분하는 용도.
        'HTTP-Referer': env.APP_URL || '',
        'X-Title': 'my-portfolio',
      },
      body: JSON.stringify({
        model: models[0],
        // 첫 모델이 죽거나 한도에 걸리면 OpenRouter가 다음 모델로 넘긴다.
        models,
        messages: buildInsightMessages(asset, payload?.question),
        max_tokens: Number(env.MAX_TOKENS) || 900,
        temperature: 0.3,
        // reasoning 모델이 걸리면 사고 과정이 본문에 섞여 나온다. 답변만 받는다.
        reasoning: { exclude: true },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.log('openrouter-error', upstream.status, detail.slice(0, 500));
      await refundQuota(env.AI_QUOTA, identity.uid);
      return json({
        error: 'upstream-failed',
        message: 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
      }, 502, request, env);
    }

    const data = await upstream.json();
    const text = stripReasoningPreamble(data?.choices?.[0]?.message?.content);
    if (!text) {
      await refundQuota(env.AI_QUOTA, identity.uid);
      return json({ error: 'empty-response', message: '빈 응답이 돌아왔습니다.' }, 502, request, env);
    }

    return json({
      text,
      model: data?.model || models[0],
      remaining: quota.remaining,
      limit,
    }, 200, request, env);
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    await refundQuota(env.AI_QUOTA, identity.uid);
    return json({
      error: isTimeout ? 'timeout' : 'upstream-failed',
      message: isTimeout ? 'AI 응답이 너무 오래 걸립니다.' : 'AI 응답을 받지 못했습니다.',
    }, 504, request, env);
  } finally {
    clearTimeout(timeoutId);
  }
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (pathname === '/health') {
      return json({ ok: true }, 200, request, env);
    }
    if (pathname === '/api/market-calendar') {
      if (request.method !== 'GET') {
        return json({ error: 'method-not-allowed' }, 405, request, env);
      }
      return handleMarketCalendar(request, env);
    }
    if (pathname !== '/api/insight') {
      return json({ error: 'not-found' }, 404, request, env);
    }
    if (request.method !== 'POST') {
      return json({ error: 'method-not-allowed' }, 405, request, env);
    }

    return handleInsight(request, env);
  },
};
