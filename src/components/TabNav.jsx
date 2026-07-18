import { ArrowRightLeft, CalendarDays, StickyNote, Target, Wallet } from 'lucide-react';

const TABS = [
  { id: 'portfolio', label: '포트폴리오', shortLabel: '자산', icon: Wallet },
  { id: 'history', label: '수익 · 배당', shortLabel: '수익', icon: ArrowRightLeft },
  { id: 'target', label: '목표 포트폴리오', shortLabel: '목표', icon: Target },
  { id: 'notes', label: '투자 메모', shortLabel: '메모', icon: StickyNote },
  { id: 'calendar', label: '배당 캘린더', shortLabel: '배당', icon: CalendarDays },
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
      className={`${mobile ? 'mobile-tab-button' : 'desktop-tab-button'} ${isActive ? 'is-active' : ''}`}
    >
      <Icon size={mobile ? 18 : 15} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
      <span>{mobile ? tab.shortLabel : tab.label}</span>
      {!mobile && isActive && <i className="desktop-tab-button__indicator" aria-hidden="true" />}
    </button>
  );
});

const TabNav = ({ activeTab, onChange }) => (
  <nav role="tablist" aria-label="포트폴리오 화면" className="mobile-tab-nav">
    <TabButtons activeTab={activeTab} mobile onChange={onChange} />
  </nav>
);

export default TabNav;
