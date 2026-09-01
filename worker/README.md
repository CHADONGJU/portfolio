# AI 요약 프록시 (Cloudflare Worker)

프런트에서 OpenRouter를 직접 부르면 API 키가 번들에 그대로 박힌다. 이 Worker가
키를 들고 있고, 프런트는 Firebase 로그인 토큰만 보낸다.

요청 한 건이 통과하는 순서:

1. `Origin`이 화이트리스트에 있는지 확인 (CORS)
2. `Authorization: Bearer <Firebase ID 토큰>` 서명 검증 (Google JWK, `aud`/`iss`/`exp` 확인)
3. KV에서 `uid`의 오늘 사용량을 읽어 한도 초과면 429
4. 종목 필드만 받아 서버에서 프롬프트를 조립 → OpenRouter 호출
5. 텍스트 + 남은 횟수 반환

프롬프트를 서버에서 만드는 것이 핵심이다. 클라이언트가 `messages`를 통째로
보내게 하면 로그인만 하면 누구나 내 키로 아무 프롬프트나 돌릴 수 있다.

## 배포

```bash
cd worker
npm install

# 1) 일일 한도 카운터용 KV 생성 → 출력된 id를 wrangler.toml에 붙여넣는다
npx wrangler kv namespace create AI_QUOTA

# 2) wrangler.toml의 REPLACE_ME 3곳을 채운다
#    FIREBASE_PROJECT_ID / ALLOWED_ORIGINS / APP_URL / kv id

# 3) OpenRouter 키를 secret으로 등록 (vars에 넣지 말 것)
npx wrangler secret put OPENROUTER_API_KEY

# 4) 배포
npx wrangler deploy
```

배포 후 나온 `https://my-portfolio-ai.<subdomain>.workers.dev` 를 프런트
`.env.local`의 `VITE_AI_PROXY_URL`에 넣는다.

로컬 개발은 `.dev.vars`에 `OPENROUTER_API_KEY=...`를 두고 `npx wrangler dev`.

## 환경 변수

| 이름 | 위치 | 설명 |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | secret | OpenRouter API 키 |
| `FIREBASE_PROJECT_ID` | vars | ID 토큰 검증 대상 프로젝트 |
| `ALLOWED_ORIGINS` | vars | 허용 오리진, 콤마 구분 |
| `AI_MODELS` | vars | 모델 slug 목록. 앞에서부터 시도하고 실패 시 다음으로 폴백 |
| `DAILY_LIMIT` | vars | 사용자 1명당 하루 호출 횟수 (기본 20) |
| `MAX_TOKENS` | vars | 응답 최대 토큰 (기본 900) |
| `APP_URL` | vars | OpenRouter 대시보드 표기용 |

## 유료 모델로 전환

`AI_MODELS`만 바꾸고 재배포하면 된다. 무료 모델은 공급자 사정으로 slug가
사라지는 일이 있으므로 배포 전 <https://openrouter.ai/models> 에서 slug가
살아 있는지 확인한다.

```toml
AI_MODELS = "z-ai/glm-5.3-flash,z-ai/glm-5.2:free"
```

OpenRouter 대시보드에서 키별 지출 한도(credit limit)를 걸어 두면, 이 Worker의
일일 한도가 뚫리더라도 과금 상한이 한 겹 더 남는다.

## 알려진 한계

- KV는 강한 일관성이 없어서 같은 사용자가 동시에 여러 번 누르면 카운트가 한두 개
  샐 수 있다. 과금 폭주 차단이 목적이라 그대로 둔다. 정확한 집계가 필요하면
  Durable Object로 옮긴다.
- 스트리밍(SSE)은 아직 붙이지 않았다. 응답이 다 만들어진 뒤 한 번에 온다.
- OpenRouter 쪽 실패(502/504)와 빈 응답은 한도를 환불한다. 인증 실패나 잘못된
  요청은 애초에 차감 전에 걸러진다.
