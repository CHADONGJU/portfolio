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
      <div className="min-h-[100dvh] bg-surface flex items-center justify-center">
        <span
          role="status"
          aria-label="로그인 상태를 확인하는 중"
          className="w-7 h-7 rounded-full border-[3px] border-line border-t-brand animate-spin"
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
    <div className="min-h-[100dvh] bg-surface flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[320px] flex flex-col items-center">
        <div className="w-16 h-16 rounded-[20px] bg-brand flex items-center justify-center text-surface text-[26px] font-bold">
          주
        </div>
        <h1 className="mt-6 text-[22px] font-bold text-ink tracking-[-0.03em]">
          {DEFAULT_PORTFOLIO_NAME}
        </h1>

        {error && (
          <p
            role="alert"
            className="mt-8 w-full rounded-2xl bg-danger-soft px-4 py-3.5 text-[13px] font-semibold text-danger leading-relaxed text-center"
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
              className={`w-full h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all flex items-center justify-center gap-2.5 ${error ? 'mt-4' : 'mt-14'}`}
            >
              {isSubmitting ? (
                <span className="w-4 h-4 rounded-full border-2 border-surface/40 border-t-surface animate-spin" />
              ) : (
                <>
                  <span className="w-[22px] h-[22px] rounded-full bg-surface flex items-center justify-center">
                    <GoogleMark />
                  </span>
                  Google로 계속하기
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setAllowLocalPreview(true)}
              className="mt-2 h-12 px-4 rounded-2xl text-[14px] font-semibold text-ink-mute hover:text-ink-soft hover:bg-canvas transition-colors"
            >
              로그인 없이 사용하기
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAllowLocalPreview(true)}
            className="mt-14 w-full h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
          >
            로그인 없이 사용하기
          </button>
        )}
      </div>
    </div>
  );
};

export default AuthGate;
