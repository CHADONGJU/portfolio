import { useState } from 'react';
import { Briefcase, Check, LogOut, Pencil, Plus, RefreshCw, UserCircle, X } from 'lucide-react';
import { DEFAULT_PORTFOLIO_NAME } from '../constants';

const DashboardHeader = ({
  exchangeRate,
  isFetching,
  lastUpdated,
  onAddAsset,
  onPortfolioNameChange,
  onRefresh,
  onSignOut,
  portfolioName,
  userEmail,
}) => {
  const resolvedPortfolioName = portfolioName?.trim() || DEFAULT_PORTFOLIO_NAME;
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(resolvedPortfolioName);

  const saveName = () => {
    const nextName = nameDraft.trim() || DEFAULT_PORTFOLIO_NAME;
    onPortfolioNameChange(nextName);
    setNameDraft(nextName);
    setIsEditingName(false);
  };

  const cancelNameEdit = () => {
    setNameDraft(resolvedPortfolioName);
    setIsEditingName(false);
  };

  return (
  <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/95 p-4 md:p-6 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] border border-slate-200/70 relative overflow-hidden">
    <div className="absolute top-0 left-0 w-full h-1 bg-slate-900"></div>
    <div className="min-w-0 w-full md:w-auto">
      <div className="flex items-start gap-3 text-slate-800">
        <div className="p-2 md:p-2.5 bg-slate-900 rounded-xl text-white shadow-sm shrink-0">
          <Briefcase size={20} className="md:w-6 md:h-6" />
        </div>
        {isEditingName ? (
          <form
            className="min-w-0 flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveName();
            }}
          >
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelNameEdit();
                }
              }}
              className="min-w-0 w-full max-w-[24rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xl md:text-2xl font-bold text-slate-800 outline-none ring-2 ring-slate-100 focus:border-slate-400 focus:ring-slate-200"
              autoFocus
            />
            <button
              type="submit"
              className="shrink-0 p-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              title="이름 저장"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={cancelNameEdit}
              className="shrink-0 p-2.5 rounded-xl bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors border border-slate-100"
              title="편집 취소"
            >
              <X size={16} />
            </button>
          </form>
        ) : (
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="min-w-0 text-xl md:text-2xl font-bold truncate">{resolvedPortfolioName}</h1>
            <button
              type="button"
              onClick={() => {
                setNameDraft(resolvedPortfolioName);
                setIsEditingName(true);
              }}
              className="shrink-0 p-2 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              title="이름 편집"
            >
              <Pencil size={15} />
            </button>
          </div>
        )}
      </div>
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
      {userEmail && (
        <div className="w-full md:w-auto flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200/70 rounded-xl text-slate-500">
          <UserCircle size={16} className="text-slate-500 shrink-0" />
          <span className="min-w-0 truncate text-[11px] font-bold max-w-[180px]">{userEmail}</span>
        </div>
      )}
      <button
        onClick={onRefresh}
        disabled={isFetching}
        className="p-3 md:p-3.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition-all border border-slate-200/70 disabled:opacity-50 text-slate-600"
        title="수동 갱신"
      >
        <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
      </button>
      <button
        onClick={onAddAsset}
        className="flex-1 md:flex-none justify-center bg-slate-900 text-white px-5 md:px-6 py-3 md:py-3.5 rounded-xl font-bold text-xs shadow-sm hover:bg-slate-800 transition-colors flex items-center gap-2"
      >
        <Plus size={16} /> 자산 추가
      </button>
      {onSignOut && (
        <button
          onClick={onSignOut}
          className="p-3 md:p-3.5 bg-white rounded-xl hover:bg-rose-50 transition-all border border-slate-200/70 text-slate-400 hover:text-rose-600"
          title="로그아웃"
        >
          <LogOut size={18} />
        </button>
      )}
    </div>
  </header>
  );
};

export default DashboardHeader;
