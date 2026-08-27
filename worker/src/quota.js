/**
 * 사용자별 일일 호출 한도.
 *
 * 키가 내 지갑이므로 로그인만 했다고 무제한으로 열어 둘 수 없다. Firebase uid를
 * 기준으로 하루 N회까지만 통과시킨다.
 *
 * KV는 강한 일관성이 없어서 같은 사용자가 동시에 여러 요청을 던지면 카운트가
 * 한두 개 새어 나갈 수 있다. 과금 폭주를 막는 것이 목적이므로 그 정도 오차는
 * 감수한다. 정확한 카운팅이 필요해지면 Durable Object로 옮기면 된다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 한국 사용자 기준이라 자정 리셋도 KST로 맞춘다. UTC 기준이면 오전 9시에 리셋된다.
export const getQuotaDay = (now = Date.now()) => new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);

export const getQuotaKey = (uid, now = Date.now()) => `q:${uid}:${getQuotaDay(now)}`;

/** 다음 KST 자정까지 남은 초. 응답 헤더의 리셋 시각으로 쓴다. */
export const getSecondsUntilReset = (now = Date.now()) => {
  const shifted = now + KST_OFFSET_MS;
  const msIntoDay = shifted % 86_400_000;
  return Math.ceil((86_400_000 - msIntoDay) / 1000);
};

export const consumeQuota = async (kv, uid, limit, now = Date.now()) => {
  if (!kv) return { allowed: true, used: 0, remaining: limit };

  const key = getQuotaKey(uid, now);
  const used = Number(await kv.get(key)) || 0;

  if (used >= limit) {
    return { allowed: false, used, remaining: 0 };
  }

  const next = used + 1;
  // 자정이 지나면 키가 알아서 사라지도록 남은 시간 + 여유를 TTL로 준다.
  await kv.put(key, String(next), { expirationTtl: getSecondsUntilReset(now) + 3600 });

  return { allowed: true, used: next, remaining: limit - next };
};

/**
 * 차감한 1회를 되돌린다.
 *
 * OpenRouter가 죽었거나 응답이 비어 돌아온 건 사용자 잘못이 아니다. 그걸로 한도를
 * 깎으면 "눌렀는데 아무것도 못 받고 횟수만 줄었다"가 되어 버린다.
 *
 * consumeQuota와 같은 이유로 여기도 원자적이지 않다. 동시 요청이 겹치면 환불이
 * 한두 개 어긋날 수 있는데, 방향이 사용자에게 유리한 쪽이라 그대로 둔다.
 */
export const refundQuota = async (kv, uid, now = Date.now()) => {
  if (!kv) return;

  const key = getQuotaKey(uid, now);
  const used = Number(await kv.get(key)) || 0;
  if (used <= 0) return;

  await kv.put(key, String(used - 1), { expirationTtl: getSecondsUntilReset(now) + 3600 });
};
