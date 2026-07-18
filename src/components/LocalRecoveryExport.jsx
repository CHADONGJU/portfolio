import { Download, ShieldCheck } from 'lucide-react';
import { createPortfolioBackup } from '../utils/portfolioBackup';
import { buildLegacyLocalSnapshot, summarizeLocalSnapshot } from '../utils/localRecoveryExport';

const LocalRecoveryExport = () => {
  const snapshot = buildLegacyLocalSnapshot(window.localStorage);
  const summary = summarizeLocalSnapshot(snapshot);
  const hasData = summary.assetCount > 0 || summary.ledgerCount > 0 || summary.memoCount > 0;

  const downloadBackup = () => {
    const backup = {
      ...createPortfolioBackup(snapshot),
      recoverySource: 'legacy-local-storage-read-only',
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mobile-local-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="auth-page">
      <section className="auth-card" style={{ maxWidth: 520 }}>
        <div className="auth-card__icon"><ShieldCheck size={22} /></div>
        <span className="auth-card__eyebrow">READ-ONLY RECOVERY</span>
        <h2>이 기기의 이전 데이터 구조</h2>
        <p className="auth-card__description">
          이 화면은 Firebase 로그인·클라우드 동기화·저장을 실행하지 않고 이전 로컬 키만 읽습니다.
        </p>
        <div className="auth-notice" style={{ marginTop: 24, display: 'grid', gap: 8 }}>
          <strong>자산 {summary.assetCount}개 · 거래 원장 {summary.ledgerCount}건 · 메모 {summary.memoCount}건</strong>
          <span>마지막 기록: {summary.latestUpdatedAt || '기록 시각 없음'}</span>
        </div>
        <button
          type="button"
          className="google-signin-button"
          onClick={downloadBackup}
          disabled={!hasData}
          style={{ marginTop: 20 }}
        >
          <Download size={18} />
          {hasData ? '이전 로컬 데이터 백업 받기' : '이전 로컬 데이터가 없습니다'}
        </button>
        <p className="auth-card__footer">다운로드 전후로 클라우드 데이터는 변경되지 않습니다.</p>
      </section>
    </main>
  );
};

export default LocalRecoveryExport;
