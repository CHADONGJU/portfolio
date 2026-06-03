import { useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
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

const AuthGate = ({ children }) => {
  const { user, isAuthLoading, isFirebaseConfigured, signInWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowLocalPreview, setAllowLocalPreview] = useState(false);

  if (isAuthLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#f6f8fb] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200/70 rounded-2xl p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04)] text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mb-4">
            <ShieldCheck size={24} />
          </div>
          <p className="text-sm font-bold text-slate-500">로그인 상태를 확인하는 중입니다.</p>
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
    <div className="min-h-[100dvh] bg-[#f6f8fb] flex items-center justify-center p-4 md:p-8 text-slate-900">
      <div className="w-full max-w-md bg-white border border-slate-200/70 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-6 md:p-8 border-b border-slate-100 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-slate-900 text-white flex items-center justify-center mb-5 shadow-sm">
            <LockKeyhole size={22} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">로그인</h1>
        </div>

        {!isFirebaseConfigured ? (
          <div className="p-6 md:p-8 space-y-4">
            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
              <p className="text-sm font-bold text-amber-700">Firebase 설정이 필요합니다.</p>
              <p className="mt-2 text-xs font-medium text-amber-700 leading-relaxed">
                `.env.local`에 Firebase 웹 앱 설정값을 채우면 Google 로그인이 활성화됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAllowLocalPreview(true)}
              className="w-full px-5 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors"
            >
              설정 전 로컬로 보기
            </button>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-4">
            {error && (
                <p className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-xs font-bold text-rose-600">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting}
              className="w-full px-5 py-3.5 bg-white text-slate-800 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-3"
            >
              <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-base font-black text-slate-900">G</span>
              {isSubmitting ? 'Google 로그인 중...' : 'Google로 계속하기'}
            </button>

            <button
              type="button"
              onClick={() => setAllowLocalPreview(true)}
              className="w-full px-5 py-3 text-xs font-bold text-slate-400"
            >
              로그인 없이 로컬로 보기
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthGate;
