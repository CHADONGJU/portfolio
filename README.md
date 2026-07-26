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
  constants.js                    # 저장소 키와 자산 색상
```

## 데이터 저장

사용자 자산과 매매 기록은 서버가 아니라 브라우저 `localStorage`에 저장됩니다. 브라우저 데이터 삭제, 다른 브라우저 사용, 시크릿 모드에서는 기존 기록이 보이지 않을 수 있습니다.

## 참고

외부 API와 무료 CORS 프록시에 의존하므로 네트워크 상태나 제공처 정책에 따라 일부 시세 갱신이 실패할 수 있습니다. 실패한 경우 앱은 기존 저장 값을 유지하고 동기화 토스트로 상태를 알려줍니다.
