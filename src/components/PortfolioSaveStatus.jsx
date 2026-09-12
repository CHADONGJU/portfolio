// 클라우드 저장 상태 표시(불러오는 중·저장 중·저장 완료·실패).
// 저장이 실패한 채로 조용히 넘어가면 사용자는 기록이 남았다고 믿는다.
import { getPortfolioSyncError } from '../utils/portfolioSyncErrors.js';

const LABELS = {
  loading: '계정 기록을 불러오는 중',
  saving: '저장 중',
  saved: '저장 완료',
  pending: '이 기기에 보관됨 · 서버 전송 대기',
  'local-error': '기기 저장 실패 · 복구본을 내려받아 주세요',
  local: '이 기기에 저장 중',
};

export default function PortfolioSaveStatus({ sync }) {
  const needsRetry = sync.failed || ['error', 'local-error'].includes(sync.phase);
  const error = needsRetry ? sync.error || getPortfolioSyncError(
    sync.phase === 'local-error' ? { code: 'local-persistence-failed' } : null,
  ) : null;
  const isConnectionError = ['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(error?.code);
  const canDownloadRecovery = sync.recoveryCount > 0 || sync.pending || sync.phase === 'local-error';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-ink-mute">
      <span role="status" className={needsRetry ? 'text-danger' : ''}>
        {error?.message || LABELS[sync.phase] || LABELS.pending}
        {needsRetry && sync.pending && error?.code !== 'local-persistence-failed' && ' 미전송 기록은 이 기기에 보관 중입니다.'}
      </span>
      {needsRetry && <button type="button" onClick={sync.retry} className="underline underline-offset-4 text-ink">{isConnectionError ? '다시 연결' : '다시 시도'}</button>}
      {canDownloadRecovery && (
        <button type="button" onClick={sync.downloadRecovery} className="underline underline-offset-4 text-ink">
          {sync.recoveryCount > 0 ? '보존된 복구본 내려받기' : '미전송 기록 내려받기'}
        </button>
      )}
    </div>
  );
}
