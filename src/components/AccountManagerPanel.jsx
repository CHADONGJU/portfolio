import { Sparkles, UserRound, X } from 'lucide-react';

/**
 * 계좌 관리 패널.
 * 연도별 수익률이 매매 기록 기반으로 바뀌면서 입출금·연초 평가액 입력은
 * 더 이상 쓰지 않는다. 새 기능이 정해질 때까지 빈 자리로 둔다.
 */
const AccountManagerPanel = ({ onClose }) => (
  <div className="w-full md:max-w-3xl max-h-[92dvh] bg-surface rounded-t-[28px] md:rounded-[28px] overflow-hidden flex flex-col shadow-2xl">
    <div className="p-5 md:p-7 border-b border-line flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-ink text-surface grid place-items-center"><UserRound size={20} /></div>
        <h2 id="account-manager-title" className="text-lg md:text-xl font-bold text-ink">계좌 관리</h2>
      </div>
      <button type="button" onClick={onClose} aria-label="계좌 관리 닫기" className="w-10 h-10 rounded-xl bg-canvas text-ink-mute grid place-items-center hover:text-ink"><X size={18} /></button>
    </div>

    <div className="overflow-y-auto scroll-soft p-5 md:p-7">
      <div className="py-16 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-2xl bg-canvas text-ink-mute grid place-items-center"><Sparkles size={20} /></div>
        <p className="mt-4 text-sm md:text-base font-bold text-ink">준비 중인 공간입니다.</p>
        <p className="mt-1.5 text-xs font-semibold text-ink-mute">새로운 기능이 이곳에 들어올 예정입니다.</p>
      </div>
    </div>
  </div>
);

export default AccountManagerPanel;
