import { useState } from 'react';
import { Cloud, LineChart, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/useAuth';

const getAuthErrorMessage = (code) => {
  const messages = {
    'auth/account-exists-with-different-credential': '이미 다른 로그인 방식으로 가입된 이메일입니다.',
    'auth/popup-blocked': '로그인 팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.',
    'auth/popup-closed-by-user': 'Google 로그인 창이 닫혔습니다.',
    'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  };
  return messages[code] || 'Google 로그인 처리 중 오류가 발생했습니다.';
};

const AuthGate = ({ children }) => {
  const { user, isAuthLoading, isFirebaseConfigured, signInWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowLocalPreview, setAllowLocalPreview] = useState(false);
  const allowDevelopmentPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('preview') === 'local';

  if (isAuthLoading && !allowDevelopmentPreview) {
    return (
      <div className="auth-page">
        <div className="auth-loading-card">
          <div className="auth-loading-card__icon"><ShieldCheck size={25} /></div>
          <p>안전하게 포트폴리오를 불러오는 중입니다.</p>
          <span className="auth-loading-bar"><i /></span>
        </div>
      </div>
    );
  }

  if (user || allowLocalPreview || allowDevelopmentPreview) return children;

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (authError) {
      setError(getAuthErrorMessage(authError.code));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb--one" aria-hidden="true" />
      <div className="auth-orb auth-orb--two" aria-hidden="true" />

      <main className="auth-shell">
        <section className="auth-story">
          <div className="auth-brand-mark"><LineChart size={25} /></div>
          <span className="auth-kicker"><Sparkles size={13} /> PERSONAL WEALTH OS</span>
          <h1>흩어진 자산을<br />한 화면에서 선명하게.</h1>
          <p>국내·해외 주식, 실현손익, 배당과 목표 비중까지 정확한 숫자와 정돈된 흐름으로 관리하세요.</p>

          <div className="auth-feature-list">
            <div><ShieldCheck size={17} /><span><strong>Private</strong> 개인 계정 기반 데이터 보호</span></div>
            <div><Cloud size={17} /><span><strong>Synced</strong> 기기 간 포트폴리오 동기화</span></div>
            <div><LineChart size={17} /><span><strong>Live</strong> 시장 가격과 환율 자동 반영</span></div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card__icon"><LockKeyhole size={21} /></div>
          <span className="auth-card__eyebrow">Welcome back</span>
          <h2>포트폴리오에 로그인</h2>
          <p className="auth-card__description">저장된 자산과 배당 기록을 안전하게 불러옵니다.</p>

          {!isFirebaseConfigured ? (
            <div className="mt-7 space-y-4">
              <div className="auth-notice auth-notice--warning">
                <strong>Firebase 설정이 필요합니다.</strong>
                <span><code>.env.local</code>에 Firebase 연결 정보를 입력하면 Google 로그인이 활성화됩니다.</span>
              </div>
              <button type="button" onClick={() => setAllowLocalPreview(true)} className="auth-primary-button">
                로컬 미리보기 열기
              </button>
            </div>
          ) : (
            <div className="mt-7 space-y-3">
              {error && <p className="auth-notice auth-notice--error">{error}</p>}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="google-signin-button"
              >
                <span className="google-mark">G</span>
                {isSubmitting ? 'Google 로그인 중…' : 'Google로 계속하기'}
              </button>

              <button type="button" onClick={() => setAllowLocalPreview(true)} className="auth-preview-button">
                로그인 없이 로컬로 둘러보기
              </button>
            </div>
          )}

          <p className="auth-card__footer">계속하면 개인 포트폴리오 데이터 동기화에 동의하게 됩니다.</p>
        </section>
      </main>
    </div>
  );
};

export default AuthGate;
