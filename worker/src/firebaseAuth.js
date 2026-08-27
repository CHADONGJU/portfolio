/**
 * Firebase ID 토큰 검증.
 *
 * Worker에는 firebase-admin을 올릴 수 없다(Node 전용 API 의존). 대신 Google이
 * 공개하는 JWK 세트로 서명을 직접 검증한다. x509 PEM 엔드포인트가 아니라 JWK
 * 엔드포인트를 쓰는 이유는 WebCrypto가 JWK를 그대로 import 할 수 있어서다.
 */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// 키는 몇 시간 단위로만 바뀐다. 요청마다 받아오면 지연이 그대로 사용자에게 간다.
let jwksCache = { keys: null, expiresAt: 0 };

const decodeBase64Url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const decodeJsonSegment = (segment) => JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));

const loadJwks = async () => {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expiresAt > now) return jwksCache.keys;

  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error('jwks-fetch-failed');

  const body = await response.json();
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1]) || 3600;

  jwksCache = { keys: body.keys || [], expiresAt: now + maxAge * 1000 };
  return jwksCache.keys;
};

/**
 * 검증에 실패하면 예외 대신 null을 돌려준다. 호출부에서 401로 바꾸기만 하면 되고,
 * 실패 사유를 응답에 흘리지 않기 위해서다.
 */
export const verifyFirebaseIdToken = async (token, projectId) => {
  if (!token || typeof token !== 'string') return null;

  const segments = token.split('.');
  if (segments.length !== 3) return null;

  let header;
  let payload;
  try {
    header = decodeJsonSegment(segments[0]);
    payload = decodeJsonSegment(segments[1]);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  // 기기 시계가 조금 어긋나도 바로 튕기지 않도록 60초 여유를 둔다.
  const skew = 60;
  if (typeof payload.exp !== 'number' || payload.exp + skew < nowSeconds) return null;
  if (typeof payload.iat !== 'number' || payload.iat - skew > nowSeconds) return null;
  if (payload.aud !== projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (!payload.sub || typeof payload.sub !== 'string') return null;

  const keys = await loadJwks();
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) return null;

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.n ? 'RSA' : jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signedData = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    decodeBase64Url(segments[2]),
    signedData,
  );
  if (!isValid) return null;

  return { uid: payload.sub, email: payload.email || null };
};
