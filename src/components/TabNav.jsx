const TABS = [
  { id: 'portfolio', label: '내 포트폴리오' },
  { id: 'history', label: '수익·배당' },
  { id: 'target', label: '목표' },
  { id: 'notes', label: '메모' },
  { id: 'calendar', label: '캘린더' },
];

const TabNav = ({ activeTab, onChange }) => (
  <nav
    aria-label="화면 전환"
    className="flex gap-1 overflow-x-auto scroll-soft -mx-1 px-1 border-b border-line"
  >
    {TABS.map((tab) => {
      const isActive = activeTab === tab.id;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={isActive ? 'page' : undefined}
          className={`relative shrink-0 px-3.5 md:px-5 h-12 md:h-[52px] text-[14px] md:text-[15px] whitespace-nowrap transition-colors ${
            isActive ? 'text-ink font-bold' : 'text-ink-mute font-semibold hover:text-ink-soft'
          }`}
        >
          {tab.label}
          <span
            aria-hidden="true"
            className={`absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full transition-opacity ${
              isActive ? 'bg-ink opacity-100' : 'opacity-0'
            }`}
          />
        </button>
      );
    })}
  </nav>
);

export default TabNav;
