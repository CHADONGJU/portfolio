import { useState } from 'react';
import { useAuth } from '../context/useAuth';
import { DEFAULT_PORTFOLIO_NAME } from '../constants';

const getAuthErrorMessage = (code) => {
  const messages = {
    'auth/account-exists-with-different-credential': '이미 다른 로그인 방식으로 가입된 이메일입니다.',
    'auth/popup-blocked': '팝업이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.',
    'auth/popup-closed-by-user': 'Google 로그인 창이 닫혔습니다.',
    'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  };
  return messages[code] || 'Google 로그인 처리 중 오류가 발생했습니다.';
};

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>
);

const AuthGate = ({ children }) => {
  const { user, isAuthLoading, isFirebaseConfigured, signInWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowLocalPreview, setAllowLocalPreview] = useState(false);

  if (isAuthLoading) {
    return (
      <div className="auth-screen flex items-center justify-center">
        <div className="auth-grid" aria-hidden="true" />
        <span
          role="status"
          aria-label="로그인 상태를 확인하는 중"
          className="w-7 h-7 rounded-full border-[3px] border-white/12 border-t-white/70 animate-spin"
        />
      </div>
    );
  }

  if (user || allowLocalPreview) return children;

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
    <div className="auth-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="auth-grid" aria-hidden="true" />

      <main className="w-full max-w-[384px] anim-rise">
        <div className="auth-card px-7 pt-9 pb-7 md:px-8 md:pt-10 md:pb-8 flex flex-col items-center text-center">
          <div className="auth-mark w-14 h-14 rounded-[18px] flex items-center justify-center text-white text-[23px] font-bold tracking-[-0.04em]">
            주
          </div>

          <h1 className="mt-5 text-[21px] font-bold text-white tracking-[-0.035em]">
            {DEFAULT_PORTFOLIO_NAME}
          </h1>

          <div className="auth-divider w-full mt-7" aria-hidden="true" />

          {error && (
            <p
              role="alert"
              className="mt-6 w-full rounded-2xl bg-[#c8433f]/16 ring-1 ring-inset ring-[#c8433f]/30 px-4 py-3.5 text-[13px] font-semibold text-[#f5b0ac] leading-relaxed"
            >
              {error}
            </p>
          )}

          {isFirebaseConfigured ? (
            <>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className={`auth-btn-primary w-full h-[52px] rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2.5 ${error ? 'mt-4' : 'mt-5'}`}
              >
                {isSubmitting ? (
                  <span className="w-4 h-4 rounded-full border-2 border-black/15 border-t-black/60 animate-spin" />
                ) : (
                  <>
                    <GoogleMark />
                    Google로 계속하기
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setAllowLocalPreview(true)}
                className="auth-btn-ghost mt-2 w-full h-12 rounded-2xl text-[14px] font-semibold"
              >
                로그인 없이 둘러보기
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAllowLocalPreview(true)}
              className="auth-btn-primary mt-5 w-full h-[52px] rounded-2xl font-bold text-[15px]"
            >
              로그인 없이 둘러보기
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default AuthGate;
