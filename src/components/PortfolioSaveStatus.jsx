const LABELS = {
  loading: '계정 기록을 불러오는 중',
  saving: '저장 중',
  saved: '저장 완료',
  pending: '이 기기에 보관됨 · 서버 전송 대기',
  error: '서버 연결 실패 · 미전송 기록 보관 중',
  'local-error': '기기 저장 실패 · 복구본을 내려받아 주세요',
  local: '이 기기에 저장 중',
};

export default function PortfolioSaveStatus({ sync }) {
  const needsRetry = sync.failed || ['error', 'local-error'].includes(sync.phase);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-ink-mute">
      <span role="status" className={needsRetry ? 'text-danger' : ''}>{LABELS[sync.phase] || LABELS.pending}</span>
      {needsRetry && <button type="button" onClick={sync.retry} className="underline underline-offset-4 text-ink">다시 연결</button>}
      {(sync.recoveryCount > 0 || sync.pending) && (
        <button type="button" onClick={sync.downloadRecovery} className="underline underline-offset-4 text-ink">
          {sync.recoveryCount > 0 ? '보존된 복구본 내려받기' : '미전송 기록 내려받기'}
        </button>
      )}
    </div>
  );
}
