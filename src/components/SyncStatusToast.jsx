import { Activity, AlertCircle, CheckCircle2 } from 'lucide-react';

const SyncStatusToast = ({ syncStatus }) => (
  <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] md:left-auto md:right-4 md:top-4 z-50 flex flex-col gap-2 pointer-events-none">
    {syncStatus.map((log) => (
      <div
        key={log.id}
        className={`w-full md:w-auto md:min-w-[18rem] px-4 py-3 rounded-2xl shadow-lg shadow-slate-200/60 border text-xs font-bold flex items-center gap-2 animate-in fade-in md:slide-in-from-right-10 duration-300 ${log.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-600' : log.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-white border-slate-100 text-slate-600'}`}
      >
        {log.type === 'error' ? (
          <AlertCircle size={14} />
        ) : log.type === 'success' ? (
          <CheckCircle2 size={14} />
        ) : (
          <Activity size={14} className="animate-spin" />
        )}
        {log.msg}
      </div>
    ))}
  </div>
);

export default SyncStatusToast;
