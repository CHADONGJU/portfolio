import { Activity, AlertCircle, CheckCircle2 } from 'lucide-react';

const SyncStatusToast = ({ isFetching = false, syncLabel = '', syncStatus }) => (
  <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[100] flex flex-col gap-2 pointer-events-none md:left-auto md:right-5 md:top-5">
    {isFetching && (
      <div className="sync-toast sync-toast--info" role="status" aria-live="polite">
        <span className="sync-toast__icon">
          <Activity size={15} className="animate-spin" />
        </span>
        <span>{syncLabel || '시세·배당 데이터를 계산하고 있습니다.'}</span>
      </div>
    )}
    {syncStatus.map((log) => (
      <div key={log.id} className={`sync-toast sync-toast--${log.type || 'info'}`}>
        <span className="sync-toast__icon">
          {log.type === 'error' ? (
            <AlertCircle size={15} />
          ) : log.type === 'success' ? (
            <CheckCircle2 size={15} />
          ) : (
            <Activity size={15} className="animate-spin" />
          )}
        </span>
        <span>{log.msg}</span>
      </div>
    ))}
  </div>
);

export default SyncStatusToast;
