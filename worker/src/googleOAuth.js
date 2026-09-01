const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const encoder = new TextEncoder();

let tokenCache = { accessToken: '', expiresAt: 0 };

const toBase64Url = (value) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const pemToBytes = (pem) => {
  const normalized = String(pem || '').trim().replaceAll('\\n', '\n');
  const base64 = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  if (!base64) throw new Error('firebase-service-account-private-key-missing');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const createServiceAccountJwt = async ({ clientEmail, privateKey, now = Date.now() }) => {
  if (!clientEmail) throw new Error('firebase-service-account-email-missing');
  const issuedAt = Math.floor(now / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = toBase64Url(JSON.stringify({
    iss: clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsignedToken));
  return `${unsignedToken}.${toBase64Url(signature)}`;
};

export const getServiceAccountAccessToken = async (env, options = {}) => {
  const now = Number(options.now) || Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60_000) return tokenCache.accessToken;

  const assertion = await createServiceAccountJwt({
    clientEmail: String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    privateKey: env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,
    now,
  });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`google-oauth-token-failed:${response.status}`);

  const data = await response.json();
  if (!data?.access_token) throw new Error('google-oauth-token-missing');
  const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return tokenCache.accessToken;
};

export const clearServiceAccountTokenCache = () => {
  tokenCache = { accessToken: '', expiresAt: 0 };
};
