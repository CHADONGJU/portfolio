import { useRef, useState } from 'react';
import {
  BriefcaseBusiness,
  Check,
  Download,
  Eye,
  EyeOff,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
  UserCircle,
  X,
} from 'lucide-react';
import { DEFAULT_PORTFOLIO_NAME } from '../constants';

const DashboardHeader = ({
  exchangeRate,
  isFetching,
  syncLabel,
  lastUpdated,
  onAddAsset,
  onExportBackup,
  onImportBackup,
  onPortfolioNameChange,
  onRefresh,
  onSignOut,
  onTogglePrivacy,
  portfolioName,
  privacyMode,
  userEmail,
}) => {
  const resolvedPortfolioName = portfolioName?.trim() || DEFAULT_PORTFOLIO_NAME;
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(resolvedPortfolioName);
  const backupInputRef = useRef(null);

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
    <header className="dashboard-header">
      <div className="dashboard-header__glow" aria-hidden="true" />

      <div className="relative z-10 flex min-w-0 flex-1 items-start gap-3.5 md:items-center md:gap-4">
        <div className="dashboard-header__mark">
          <BriefcaseBusiness size={24} strokeWidth={2.1} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="dashboard-eyebrow">Portfolio command center</span>
            <span className="live-badge"><i /> LIVE</span>
          </div>

          {isEditingName ? (
            <form
              className="flex min-w-0 items-center gap-2"
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
                className="dashboard-title-input"
                aria-label="포트폴리오 이름"
                autoFocus
              />
              <button type="submit" className="icon-button icon-button--primary" title="이름 저장">
                <Check size={16} />
              </button>
              <button type="button" onClick={cancelNameEdit} className="icon-button" title="편집 취소">
                <X size={16} />
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="truncate text-[1.45rem] font-black tracking-[-0.035em] text-slate-950 md:text-[1.8rem]">
                {resolvedPortfolioName}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(resolvedPortfolioName);
                  setIsEditingName(true);
                }}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/80 hover:text-blue-600"
                title="포트폴리오 이름 편집"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500 md:text-[11px]">
            <span className="dashboard-meta-chip">
              <span className={`status-dot ${isFetching ? 'status-dot--syncing' : ''}`} />
              {isFetching ? (syncLabel || '시세·배당 동기화 중') : lastUpdated ? `${lastUpdated} 기준` : '데이터 확인 중'}
            </span>
            <span className="dashboard-meta-chip">
              환율&nbsp;
              <strong className="text-slate-700">
                {exchangeRate === 0
                  ? '연동 중'
                  : `$1 = ${exchangeRate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`}
              </strong>
            </span>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
        {userEmail && (
          <div className="user-chip hidden xl:flex">
            <UserCircle size={16} />
            <span className="max-w-[170px] truncate">{userEmail}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onTogglePrivacy}
          aria-pressed={privacyMode}
          aria-label={privacyMode ? '금액 가리기 해제' : '금액 가리기'}
          className={`icon-button ${privacyMode ? 'icon-button--active' : ''}`}
          title={privacyMode ? '금액 가리기 해제' : '금액 가리기'}
        >
          {privacyMode ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="icon-button"
          title="시세·환율·배당 새로고침"
        >
          <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={onExportBackup}
          className="icon-button"
          title="전체 데이터 JSON 백업"
          aria-label="전체 데이터 JSON 백업"
        >
          <Download size={18} />
        </button>
        <button
          type="button"
          onClick={() => backupInputRef.current?.click()}
          className="icon-button"
          title="JSON 백업 복원"
          aria-label="JSON 백업 복원"
        >
          <Upload size={18} />
        </button>
        <input
          ref={backupInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const [file] = event.target.files || [];
            onImportBackup(file);
            event.target.value = '';
          }}
        />
        <button type="button" onClick={onAddAsset} className="primary-action">
          <Plus size={17} strokeWidth={2.5} />
          <span>자산 추가</span>
        </button>
        {onSignOut && (
          <button type="button" onClick={onSignOut} className="icon-button icon-button--danger" title="로그아웃">
            <LogOut size={18} />
          </button>
        )}
      </div>
    </header>
  );
};

export default DashboardHeader;
