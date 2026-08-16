import { Suspense, lazy } from 'react';

/**
 * 로그인 화면은 App(수천 줄)과 Firestore 코드가 전혀 필요 없다. 정적으로 import하면
 * 로그인 전에도 번들 전체를 내려받고 파싱할 때까지 화면이 비어 있다.
 * AuthGate가 인증을 통과시킨 뒤에야 이 청크를 받아온다.
 */
const App = lazy(() => import('../App.jsx'));

const AppLoading = () => (
  <div className="min-h-screen flex items-center justify-center">
    <span
      role="status"
      aria-label="포트폴리오를 불러오는 중"
      className="w-7 h-7 rounded-full border-[3px] border-black/10 border-t-black/50 animate-spin"
    />
  </div>
);

const LazyApp = () => (
  <Suspense fallback={<AppLoading />}>
    <App />
  </Suspense>
);

export default LazyApp;
