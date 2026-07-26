import { useState } from 'react';
import { useAuth } from '../context/useAuth';

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

const HIGHLIGHTS = [
  { title: '한 화면에 모든 자산', body: '국내·해외 주식, 원자재, 현금까지 원화 기준으로 합산해서 봅니다.' },
  { title: '수익률은 자동으로', body: '시세와 환율을 주기적으로 받아와 평가손익과 실현손익을 계산합니다.' },
  { title: '배당까지 놓치지 않게', body: '보유 기간에 맞춰 배당 내역을 자동으로 정리하고 캘린더에 표시합니다.' },
];

const AuthGate = ({ children }) => {
  const { user, isAuthLoading, isFirebaseConfigured, signInWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowLocalPreview, setAllowLocalPreview] = useState(false);

  if (isAuthLoading) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
          <span className="w-8 h-8 rounded-full border-[3px] border-line border-t-brand animate-spin" />
          <p className="text-sm font-semibold text-ink-mute">로그인 상태를 확인하고 있어요</p>
        </div>
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
    <div className="min-h-[100dvh] bg-surface lg:bg-canvas lg:grid lg:grid-cols-[1.1fr_minmax(0,480px)]">
      {/* 좌측 소개 — 데스크톱에서만 */}
      <section className="hidden lg:flex flex-col justify-between p-14 xl:p-20">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[10px] bg-brand flex items-center justify-center text-surface text-sm font-bold">
            투
          </span>
          <span className="text-[15px] font-bold text-ink">투자 통합 대시보드</span>
        </div>

        <div className="max-w-lg">
          <h1 className="text-[44px] xl:text-[52px] leading-[1.15] font-bold text-ink tracking-[-0.04em]">
            흩어진 투자를
            <br />
            한 곳에서 봅니다
          </h1>
          <p className="mt-6 text-lg text-ink-soft leading-relaxed">
            계좌별로 나뉜 자산을 모아 실제 수익률을 보여주는
            <br />
            개인용 포트폴리오 대시보드입니다.
          </p>

          <ul className="mt-12 space-y-6">
            {HIGHLIGHTS.map((item, index) => (
              <li key={item.title} className="flex gap-4">
                <span className="shrink-0 w-7 h-7 rounded-full bg-brand-soft text-brand text-[13px] font-bold flex items-center justify-center tnum">
                  {index + 1}
                </span>
                <div>
                  <p className="text-[15px] font-bold text-ink">{item.title}</p>
                  <p className="mt-1 text-sm text-ink-soft leading-relaxed">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[13px] text-ink-mute">
          시세는 공개 API에서 받아오며, 투자 판단의 근거로 삼기 전에 반드시 원본을 확인하세요.
        </p>
      </section>

      {/* 우측 로그인 */}
      <section className="flex items-center justify-center min-h-[100dvh] lg:min-h-0 px-6 py-12 lg:bg-surface">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden flex items-center gap-2.5 mb-14">
            <span className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center text-surface text-base font-bold">
              투
            </span>
            <span className="text-base font-bold text-ink">투자 통합 대시보드</span>
          </div>

          <h2 className="text-[26px] lg:text-[28px] font-bold text-ink tracking-[-0.03em] leading-snug">
            안녕하세요
            <br />
            오늘도 확인해볼까요?
          </h2>
          <p className="mt-3 text-[15px] text-ink-soft leading-relaxed">
            Google 계정으로 로그인하면 자산 기록이
            <br />
            기기 사이에서 자동으로 동기화됩니다.
          </p>

          {!isFirebaseConfigured ? (
            <div className="mt-10 space-y-3">
              <div className="rounded-2xl bg-warn-soft p-5">
                <p className="text-sm font-bold text-ink">Firebase 설정이 필요합니다</p>
                <p className="mt-2 text-[13px] text-ink-soft leading-relaxed">
                  <code className="font-semibold">.env.local</code>에 Firebase 웹 앱 설정값을 채우면
                  Google 로그인이 켜집니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllowLocalPreview(true)}
                className="w-full h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong transition-colors"
              >
                설정 없이 둘러보기
              </button>
            </div>
          ) : (
            <div className="mt-10">
              {error && (
                <p
                  role="alert"
                  className="mb-3 rounded-2xl bg-danger-soft px-4 py-3.5 text-[13px] font-semibold text-danger leading-relaxed"
                >
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="w-full h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all flex items-center justify-center gap-2.5"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-surface/40 border-t-surface animate-spin" />
                    로그인하는 중
                  </>
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
                className="w-full h-12 mt-2 rounded-2xl text-[14px] font-semibold text-ink-mute hover:text-ink-soft hover:bg-canvas transition-colors"
              >
                로그인 없이 이 기기에서만 쓰기
              </button>

              <p className="mt-6 text-[12px] text-ink-mute leading-relaxed text-center">
                로그인 없이 사용하면 기록이 이 브라우저에만 저장됩니다.
                <br />
                브라우저 데이터를 지우면 함께 사라져요.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AuthGate;
