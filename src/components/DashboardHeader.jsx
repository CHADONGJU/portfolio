import { useState } from 'react';
import { Check, LogOut, Pencil, Plus, RefreshCw, X } from 'lucide-react';
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
    <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        {isEditingName ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveName();
            }}
          >
            <label htmlFor="portfolio-name" className="sr-only">
              포트폴리오 이름
            </label>
            <input
              id="portfolio-name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelNameEdit();
                }
              }}
              className="min-w-0 w-full max-w-[22rem] h-12 rounded-2xl bg-surface px-4 text-[22px] md:text-[26px] font-bold text-ink tracking-[-0.03em] outline-none ring-2 ring-brand/30 focus:ring-brand"
              autoFocus
            />
            <button
              type="submit"
              aria-label="이름 저장"
              className="shrink-0 w-11 h-11 rounded-2xl bg-ink text-surface flex items-center justify-center hover:opacity-90 transition-opacity"
            >
              <Check size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={cancelNameEdit}
              aria-label="편집 취소"
              className="shrink-0 w-11 h-11 rounded-2xl bg-surface text-ink-mute flex items-center justify-center hover:text-ink-soft transition-colors"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="min-w-0 truncate text-[24px] md:text-[30px] font-bold text-ink tracking-[-0.035em]">
              {resolvedPortfolioName}
            </h1>
            <button
              type="button"
              onClick={() => {
                setNameDraft(resolvedPortfolioName);
                setIsEditingName(true);
              }}
              aria-label="포트폴리오 이름 편집"
              className="shrink-0 w-9 h-9 rounded-xl text-ink-mute hover:text-ink-soft hover:bg-surface flex items-center justify-center transition-colors"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </div>
        )}

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink-mute">
          <span className="tnum">
            {exchangeRate === 0
              ? '환율 연동 중'
              : `$1 = ${exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}원`}
          </span>
          <span aria-hidden="true" className="w-[3px] h-[3px] rounded-full bg-line" />
          <span className="tnum">{lastUpdated ? `${lastUpdated} 기준` : '불러오는 중'}</span>
          {userEmail && (
            <>
              <span aria-hidden="true" className="hidden md:inline-block w-[3px] h-[3px] rounded-full bg-line" />
              <span className="hidden md:inline truncate max-w-[200px]">{userEmail}</span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label={isFetching ? '시세를 갱신하는 중입니다' : '시세 새로고침'}
          className="shrink-0 w-12 h-12 rounded-2xl bg-surface text-ink-soft flex items-center justify-center hover:bg-line-soft disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onAddAsset}
          className="flex-1 md:flex-none h-12 px-5 rounded-2xl bg-brand text-surface font-bold text-[15px] flex items-center justify-center gap-1.5 hover:bg-brand-strong active:scale-[0.98] transition-all"
        >
          <Plus size={17} aria-hidden="true" /> 자산 추가
        </button>

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="로그아웃"
            className="shrink-0 w-12 h-12 rounded-2xl bg-surface text-ink-mute flex items-center justify-center hover:text-danger hover:bg-danger-soft transition-colors"
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
};

export default DashboardHeader;
