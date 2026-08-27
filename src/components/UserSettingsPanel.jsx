import { Moon, Sun, UserRound, X } from 'lucide-react';

/**
 * 사용자 설정 모달 — 계정 정보와 화면 테마(라이트/다크) 전환을 담는다.
 * 앞으로 사용자별 설정이 늘어나면 이 패널에 섹션을 추가한다.
 */
const UserSettingsPanel = ({ theme, onToggleTheme, userEmail, onClose }) => {
  const isDark = theme === 'dark';

  return (
    <div className="w-full md:max-w-md bg-surface rounded-t-[28px] md:rounded-[28px] overflow-hidden flex flex-col shadow-2xl">
      <div className="p-5 md:p-7 border-b border-line flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-ink text-surface grid place-items-center"><UserRound size={20} /></div>
          <div>
            <h2 id="user-settings-title" className="text-lg md:text-xl font-bold text-ink">사용자 설정</h2>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">{userEmail ? userEmail : '로그인하지 않고 이 기기에만 저장 중'}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="사용자 설정 닫기" className="w-10 h-10 rounded-xl bg-canvas text-ink-mute grid place-items-center hover:text-ink"><X size={18} /></button>
      </div>

      <div className="p-5 md:p-7 space-y-3">
        <p className="eyebrow">화면 테마</p>
        <button
          type="button"
          onClick={onToggleTheme}
          role="switch"
          aria-checked={isDark}
          aria-label="다크 모드 전환"
          className="w-full rounded-2xl bg-canvas p-5 flex items-center justify-between gap-4 hover:bg-line-soft transition-colors"
        >
          <span className="flex items-center gap-3 text-left">
            <span className={`w-11 h-11 rounded-2xl grid place-items-center ${isDark ? 'bg-brand-soft text-brand' : 'bg-warn-soft text-warn'}`}>
              {isDark ? <Moon size={19} /> : <Sun size={19} />}
            </span>
            <span>
              <span className="block text-sm md:text-base font-bold text-ink">{isDark ? '다크 모드' : '화이트 모드'}</span>
              <span className="block text-[11px] md:text-xs font-semibold text-ink-mute mt-0.5">버튼을 누르면 바로 전환되고, 선택은 이 기기에 저장됩니다.</span>
            </span>
          </span>
          <span aria-hidden="true" className={`relative shrink-0 w-14 h-8 rounded-full transition-colors duration-200 ${isDark ? 'bg-brand' : 'bg-line'}`}>
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-200 ${isDark ? 'left-7' : 'left-1'}`} />
          </span>
        </button>
      </div>
    </div>
  );
};

export default UserSettingsPanel;
