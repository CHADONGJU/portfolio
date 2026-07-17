import { ArrowRightLeft, CalendarDays, StickyNote, Target, Wallet } from 'lucide-react';

const TABS = [
  { id: 'portfolio', label: '포트폴리오', shortLabel: '자산', icon: Wallet },
  { id: 'history', label: '수익 및 배당 기록', shortLabel: '수익', icon: ArrowRightLeft },
  { id: 'target', label: '목표 포트폴리오', shortLabel: '목표', icon: Target },
  { id: 'notes', label: '메모장', shortLabel: '메모', icon: StickyNote },
  { id: 'calendar', label: '캘린더', shortLabel: '배당', icon: CalendarDays },
];

const TabButtons = ({ activeTab, mobile = false, onChange }) => TABS.map((tab) => {
  const Icon = tab.icon;
  const isActive = activeTab === tab.id;

  return (
    <button
      key={tab.id}
      id={`tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`panel-${tab.id}`}
      onClick={() => onChange(tab.id)}
      className={mobile
        ? `flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[9px] font-black transition-colors ${
          isActive ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
        }`
        : `shrink-0 px-3 md:px-7 py-2.5 md:py-3 rounded-xl font-bold text-[10px] md:text-xs transition-all whitespace-nowrap ${
          isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
        }`}
    >
      {mobile && <Icon size={17} aria-hidden="true" />}
      <span>{mobile ? tab.shortLabel : tab.label}</span>
    </button>
  );
});

const TabNav = ({ activeTab, onChange }) => (
  <>
    <nav
      role="tablist"
      aria-label="포트폴리오 화면"
      className="hidden md:flex gap-1.5 p-1 bg-white rounded-2xl w-fit border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-x-auto max-w-full"
    >
      <TabButtons activeTab={activeTab} onChange={onChange} />
    </nav>
    <nav
      role="tablist"
      aria-label="포트폴리오 화면"
      className="fixed inset-x-3 bottom-[calc(0.65rem+env(safe-area-inset-bottom))] z-[90] flex gap-1 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-[0_12px_40px_rgba(15,23,42,0.2)] backdrop-blur md:hidden"
    >
      <TabButtons activeTab={activeTab} mobile onChange={onChange} />
    </nav>
  </>
);

export default TabNav;
