import { Component } from 'react';

/**
 * 계산 한 군데에서 예외가 나면 React가 트리 전체를 언마운트해 화면이 하얘진다.
 * 원인 데이터는 localStorage에 남아 있으므로 새로고침해도 똑같이 하얘지고,
 * 사용자는 앱 안에서 빠져나올 방법이 없다. 여기서 잡아 복구 수단을 준다.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('화면 렌더링 중 오류:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetLocalData = () => {
    const confirmed = window.confirm(
      '이 기기에 저장된 포트폴리오 데이터를 비웁니다.\n'
      + '로그인 상태라면 클라우드에 저장된 기록은 그대로 남아 다시 내려받습니다.\n\n'
      + '계속할까요?',
    );
    if (!confirmed) return;

    try {
      const portfolioKeys = Object.keys(localStorage)
        .filter((key) => key.startsWith('portfolio'));
      portfolioKeys.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.error('로컬 데이터 초기화 실패:', error);
    }

    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center px-6 py-12 bg-[var(--color-canvas,#f4f4f5)]"
      >
        <main className="w-full max-w-[420px] rounded-2xl bg-white shadow-lg px-7 py-8">
          <h1 className="text-[19px] font-bold tracking-[-0.03em]">
            화면을 그리는 중 문제가 생겼습니다
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-mute,#6b6e77)]">
            저장된 기록 하나가 예상과 다른 모양이면 이런 일이 생깁니다.
            먼저 새로고침을 해보시고, 그래도 같은 화면이 나오면 이 기기에 저장된
            데이터를 비우고 다시 받아오세요.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full h-12 rounded-xl bg-[#1f2937] text-white text-[15px] font-semibold"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={this.handleResetLocalData}
              className="w-full h-12 rounded-xl border border-[#d4d4d8] text-[15px] font-semibold"
            >
              이 기기의 저장 데이터 비우고 다시 시작
            </button>
          </div>

          <details className="mt-6">
            <summary className="text-[13px] font-semibold cursor-pointer">
              오류 내용 보기
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#f4f4f5] p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {String(error?.stack || error?.message || error)}
            </pre>
          </details>
        </main>
      </div>
    );
  }
}

export default ErrorBoundary;
