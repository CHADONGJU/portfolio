# My Portfolio

React와 Vite로 만든 개인 투자 포트폴리오 대시보드입니다. 자산을 등록하면 브라우저 `localStorage`에 저장하고 로그인 시 Firestore에 동기화하며, 환율/주가/배당 데이터를 외부 API에서 갱신해 포트폴리오 현황을 보여줍니다.

## 주요 기능

- 국내주식, 해외주식, 원자재, 현금 자산 등록
- KRW/USD 기준 매입가, 현재가, 수익률 계산
- 추가 매수와 매도 기록 관리
- 실현손익 요약 (매도 시점 환율 기준으로 환산)
- 자산군/종목별 비중 차트
- Yahoo Finance, Naver Finance, Stooq, 환율 API 기반 시세 갱신
- 매수일 기준 자동 배당 내역 추출
- 보유 종목 AI 요약 (Cloudflare Worker 프록시 + OpenRouter)

## 실행 방법

```bash
npm install
npm run dev
```

Windows PowerShell 실행 정책 때문에 `npm run ...`이 막히면 아래처럼 실행할 수 있습니다.

```bash
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

## 프로젝트 구조

```text
src/
  App.jsx                         # 앱 상태, 이벤트 핸들러, 화면 조합
  components/                     # 헤더, 탭, 동기화 토스트 등 UI 컴포넌트
  hooks/usePortfolioMetrics.js    # 포트폴리오/손익/배당 파생 계산
  services/marketData.js          # 외부 시세/환율/배당 API 연동
  utils/formatters.js             # 금액과 입력값 포맷팅
  utils/storage.js                # localStorage 로드/저장
  utils/stockInsightPayload.js    # AI 요약에 보낼 종목 필드 추리기
  services/aiInsight.js           # AI 요약 프록시 호출
  components/StockInsightPanel.jsx # AI 요약 모달
  constants.js                    # 저장소 키와 자산 색상
worker/                           # AI 요약용 Cloudflare Worker (별도 배포)
```

## AI 요약

보유 종목 행의 반짝임 아이콘을 누르면 그 종목의 사업 모델과 리스크 요약을 받는다.

OpenRouter API 키는 프런트에 두지 않는다. 정적 번들에 넣으면 누구나 꺼내 쓸 수
있기 때문이다. 대신 `worker/`의 Cloudflare Worker가 키를 들고 있고, 프런트는
Firebase 로그인 토큰만 보낸다. Worker는 토큰 서명을 검증하고 KV로 사용자별 하루
호출 횟수를 제한한 뒤 OpenRouter로 넘긴다.

설정 순서는 [`worker/README.md`](worker/README.md) 참고. 배포 후 나온 Worker
주소를 `.env.local`의 `VITE_AI_PROXY_URL`에 넣으면 버튼이 활성화된다. 값이
비어 있으면 앱은 그대로 동작하고 모달만 안내 문구를 띄운다.

## 데이터 저장

로그인한 계정의 자산과 매매 기록은 Firestore에 저장하고 기기 사이에 동기화합니다. 로그인 없이 둘러보는 경우에는 이 브라우저에만 저장합니다. 계정별 저장 영역과 게스트 영역은 서로 분리됩니다.

수정 내용은 서버로 보내기 전에 계정별 로컬 저널에 먼저 보관합니다. 서버가 저장을 확인하기 전까지 미전송 상태로 남으며, 재접속하면 마지막 저장본을 기준으로 다른 기기의 변경과 합칩니다. 같은 항목을 양쪽에서 수정한 경우 로컬 편집을 적용하고 충돌한 값도 복구본에 보존합니다. 화면의 저장 상태 옆에서 미전송 기록과 보존된 복구본을 JSON으로 내려받을 수 있습니다.

로그아웃해도 계정별 미전송 기록은 유지합니다. 브라우저 데이터를 삭제하면 서버로 전송되지 않은 기록과 게스트 기록은 사라질 수 있으므로 먼저 저장 완료를 확인하거나 복구본을 내려받으세요.

이전 연간성과 계산은 `archive/`에 보존했습니다. 기존 입출금·평가 스냅샷은 유지하되 화면에서 사용하지 않는 일별 스냅샷은 새로 생성하지 않습니다.

## 검증과 배포

`npm test`, `npm run lint`, `npm run test:browser`, `npm run build`로 검증합니다. 브라우저 검증은 Playwright와 별도 가상 계정만 사용하며 실제 Firebase 계정에 접근하지 않습니다. 처음에는 `npx playwright install chromium`을 실행하세요. Windows에서 설치된 Edge를 쓰려면 PowerShell에서 `$env:BROWSER_CHANNEL = 'msedge'`를 지정할 수 있습니다.

`npm run deploy`는 Firebase Hosting과 Firestore 규칙을 배포합니다. 증시 달력 또는 AI 프록시를 수정했다면 `worker/`에서 `npm run deploy`도 실행해야 합니다. 배포 후 앱의 번들 파일과 Worker의 달력 응답을 각각 확인합니다.

거래일은 한국시간 기준입니다. 같은 날의 거래는 체결 시각이 있으면 그것을, 없으면 기록 생성 시각을 사용합니다. 시각 정보가 없는 이전 기록만으로는 실제 체결 순서를 복원할 수 없습니다.

## 참고

외부 API와 무료 CORS 프록시에 의존하므로 네트워크 상태나 제공처 정책에 따라 일부 시세 갱신이 실패할 수 있습니다. 실패한 경우 앱은 기존 저장 값을 유지하고 동기화 토스트로 상태를 알려줍니다.
