import { useState } from 'react';
import { Check, LogOut, Pencil, Plus, RefreshCw, UserRound, X } from 'lucide-react';
import { DEFAULT_PORTFOLIO_NAME } from '../constants';

const iconButton =
  'shrink-0 w-12 h-12 rounded-2xl bg-surface flex items-center justify-center ring-1 ring-inset ring-line-soft elev-card transition-all duration-150 hover:ring-line hover:elev-lift active:scale-[0.97]';

const DashboardHeader = ({
  exchangeRate,
  isFetching,
  lastUpdated,
  onAddAsset,
  onOpenUserSettings,
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
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full ${isFetching ? 'bg-brand animate-pulse' : 'bg-line'}`}
          />
          Portfolio
        </p>

        {isEditingName ? (
          <form
            className="mt-1.5 flex items-center gap-2"
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
              className="min-w-0 w-full max-w-[22rem] h-12 rounded-2xl bg-surface px-4 text-[22px] md:text-[26px] font-bold text-ink tracking-[-0.035em] outline-none ring-2 ring-brand/30 focus:ring-brand elev-card"
              autoFocus
            />
            <button
              type="submit"
              aria-label="이름 저장"
              className="shrink-0 w-11 h-11 rounded-2xl bg-ink text-surface flex items-center justify-center hover:opacity-90 active:scale-[0.97] transition-all"
            >
              <Check size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={cancelNameEdit}
              aria-label="편집 취소"
              className="shrink-0 w-11 h-11 rounded-2xl bg-surface text-ink-mute flex items-center justify-center ring-1 ring-inset ring-line-soft hover:text-ink-soft transition-colors"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <h1 className="min-w-0 truncate text-[26px] md:text-[34px] font-bold text-ink tracking-[-0.042em] leading-[1.15]">
              {resolvedPortfolioName}
            </h1>
            <button
              type="button"
              onClick={() => {
                setNameDraft(resolvedPortfolioName);
                setIsEditingName(true);
              }}
              aria-label="포트폴리오 이름 편집"
              className="shrink-0 w-9 h-9 rounded-xl text-ink-mute/70 hover:text-ink-soft hover:bg-surface flex items-center justify-center transition-colors"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </div>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-medium text-ink-mute">
          <span className="tnum">
            {exchangeRate === 0
              ? '환율 연동 중'
              : `$1 = ${exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}원`}
          </span>
          <span aria-hidden="true" className="w-px h-3 bg-line" />
          <span className="tnum">{lastUpdated ? `${lastUpdated} 기준` : '불러오는 중'}</span>
          {userEmail && (
            <>
              <span aria-hidden="true" className="hidden md:inline-block w-px h-3 bg-line" />
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
          className={`${iconButton} text-ink-soft disabled:opacity-40 disabled:active:scale-100`}
        >
          <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onAddAsset}
          className="flex-1 md:flex-none h-12 px-5 rounded-2xl bg-brand text-surface font-bold text-[15px] flex items-center justify-center gap-1.5 hover:bg-brand-strong active:scale-[0.98] transition-all duration-150"
        >
          <Plus size={17} aria-hidden="true" /> 자산 추가
        </button>

        {onOpenUserSettings && (
          <button
            type="button"
            onClick={onOpenUserSettings}
            aria-label="사용자 설정"
            title="사용자 설정"
            className={`${iconButton} text-ink-mute hover:text-ink`}
          >
            <UserRound size={19} aria-hidden="true" />
          </button>
        )}

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="로그아웃"
            className={`${iconButton} text-ink-mute hover:text-danger`}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
};

export default DashboardHeader;
