import { buildStockInsightPayload } from '../utils/stockInsightPayload';

/**
 * AI 요약 프록시 클라이언트.
 *
 * OpenRouter를 브라우저에서 직접 부르지 않는다. 키가 번들에 박히기 때문이다.
 * 여기서는 Cloudflare Worker(worker/)만 부르고, 신원 증명으로 Firebase ID
 * 토큰을 얹는다. 한도 계산과 프롬프트 조립은 전부 Worker 쪽 책임이다.
 */
const PROXY_URL = import.meta.env.VITE_AI_PROXY_URL || '';
const REQUEST_TIMEOUT_MS = 60_000;

export const isAiInsightConfigured = Boolean(PROXY_URL);

export class AiInsightError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AiInsightError';
    this.code = code;
  }
}

export const fetchStockInsight = async ({ asset, question = '', user, signal }) => {
  if (!PROXY_URL) {
    throw new AiInsightError('AI 요약이 아직 설정되지 않았습니다.', 'not-configured');
  }
  if (!user) {
    throw new AiInsightError('로그인 후 사용할 수 있습니다.', 'unauthorized');
  }

  const payload = buildStockInsightPayload(asset);
  if (!payload) {
    throw new AiInsightError('종목 정보를 읽지 못했습니다.', 'bad-request');
  }

  // 만료된 토큰을 그대로 보내면 401만 받고 끝난다. Firebase SDK가 필요 시 갱신한다.
  const idToken = await user.getIdToken();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller);

  try {
    const response = await fetch(`${PROXY_URL.replace(/\/$/, '')}/api/insight`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ asset: payload, question }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new AiInsightError(
        data?.message || 'AI 요약을 가져오지 못했습니다.',
        data?.error || `http-${response.status}`,
      );
    }

    return {
      text: String(data.text || ''),
      model: String(data.model || ''),
      remaining: Number.isFinite(Number(data.remaining)) ? Number(data.remaining) : null,
      limit: Number.isFinite(Number(data.limit)) ? Number(data.limit) : null,
    };
  } catch (error) {
    if (error instanceof AiInsightError) throw error;
    if (error?.name === 'AbortError') {
      throw new AiInsightError('요청이 취소되었거나 너무 오래 걸렸습니다.', 'aborted');
    }
    throw new AiInsightError('네트워크 오류로 AI 요약을 가져오지 못했습니다.', 'network');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
};
