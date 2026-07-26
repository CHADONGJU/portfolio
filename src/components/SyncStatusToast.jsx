import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const ICON_TONE = {
  error: 'text-danger',
  success: 'text-brand',
  info: 'text-surface/70',
};

const SyncStatusToast = ({ syncStatus }) => (
  <div
    role="status"
    aria-live="polite"
    className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top)+1rem)] md:left-auto md:right-6 md:top-6 z-[60] flex flex-col items-center md:items-end gap-2 pointer-events-none"
  >
    {syncStatus.map((log) => (
      <div
        key={log.id}
        className="w-full md:w-auto md:max-w-[22rem] px-4 py-3.5 rounded-2xl bg-ink text-surface shadow-[0_8px_24px_rgba(25,31,40,0.18)] text-[13px] font-semibold leading-snug flex items-center gap-2.5 anim-drop"
      >
        <span className={`shrink-0 ${ICON_TONE[log.type] || ICON_TONE.info}`}>
          {log.type === 'error' ? (
            <AlertCircle size={16} aria-hidden="true" />
          ) : log.type === 'success' ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0">{log.msg}</span>
      </div>
    ))}
  </div>
);

export default SyncStatusToast;
