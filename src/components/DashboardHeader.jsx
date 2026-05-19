import { Briefcase, Plus, RefreshCw } from 'lucide-react';

const DashboardHeader = ({
  exchangeRate,
  isFetching,
  lastUpdated,
  onAddAsset,
  onRefresh,
}) => (
  <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 md:p-7 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600"></div>
    <div>
      <h1 className="text-xl md:text-2xl font-bold flex items-center gap-3 text-slate-800">
        <div className="p-2 md:p-2.5 bg-blue-600 rounded-2xl text-white shadow-md shadow-blue-100">
          <Briefcase size={20} className="md:w-6 md:h-6" />
        </div>
        투자 통합 대시보드
      </h1>
      <p className="text-slate-400 text-[10px] md:text-[11px] mt-2 font-bold uppercase tracking-[0.14em] leading-relaxed flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{lastUpdated ? `Sync: ${lastUpdated}` : 'Loading...'}</span>
        <span className="hidden md:inline-block w-1 h-1 bg-slate-300 rounded-full"></span>
        <span>
          현재 환율:{' '}
          {exchangeRate === 0
            ? '연동 중...'
            : `$1 = ${exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}원`}
        </span>
      </p>
    </div>
    <div className="flex flex-wrap gap-2 w-full md:w-auto">
      <button
        onClick={onRefresh}
        disabled={isFetching}
        className="p-3 md:p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all border border-slate-100 disabled:opacity-50 text-blue-600"
        title="수동 갱신"
      >
        <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
      </button>
      <button
        onClick={onAddAsset}
        className="flex-1 md:flex-none justify-center bg-slate-900 text-white px-5 md:px-6 py-3 md:py-4 rounded-2xl font-bold text-xs shadow-lg shadow-slate-200 hover:-translate-y-0.5 transition-transform flex items-center gap-2"
      >
        <Plus size={16} /> 자산 추가
      </button>
    </div>
  </header>
);

export default DashboardHeader;
