import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  clearServiceAccountTokenCache,
  createServiceAccountJwt,
  getServiceAccountAccessToken,
} from '../src/googleOAuth.js';

const toPem = (buffer) => {
  const base64 = Buffer.from(buffer).toString('base64');
  const lines = base64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
};

const decodeSegment = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

const createPrivateKey = async () => {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  return toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
};

test('Service Account JWT에 Firestore scope와 1시간 만료를 넣는다', async () => {
  const privateKey = await createPrivateKey();
  const now = Date.UTC(2026, 7, 28, 0, 0, 0);
  const jwt = await createServiceAccountJwt({
    clientEmail: 'snapshot@example.iam.gserviceaccount.com', privateKey, now,
  });
  const [header, claims, signature] = jwt.split('.');
  assert.equal(decodeSegment(header).alg, 'RS256');
  assert.equal(decodeSegment(claims).iss, 'snapshot@example.iam.gserviceaccount.com');
  assert.equal(decodeSegment(claims).scope, 'https://www.googleapis.com/auth/datastore');
  assert.equal(decodeSegment(claims).exp - decodeSegment(claims).iat, 3600);
  assert.ok(signature.length > 100);
});

test('OAuth access token을 만료 전까지 isolate cache에서 재사용한다', async () => {
  clearServiceAccountTokenCache();
  const privateKey = (await createPrivateKey()).replaceAll('\n', '\\n');
  let calls = 0;
  const env = {
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'snapshot@example.iam.gserviceaccount.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
  };
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 });
  };
  const now = Date.UTC(2026, 7, 28, 0, 0, 0);

  assert.equal(await getServiceAccountAccessToken(env, { fetchImpl, now }), 'token-1');
  assert.equal(await getServiceAccountAccessToken(env, { fetchImpl, now: now + 1000 }), 'token-1');
  assert.equal(calls, 1);
});
