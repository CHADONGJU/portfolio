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
    className="relative flex gap-1 overflow-x-auto scroll-soft -mx-1 px-1"
  >
    {/* 밑줄은 헤어라인 한 겹으로만 — 굵은 선은 화면을 무겁게 만든다 */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1 right-1 bottom-0 h-px bg-line"
    />

    {TABS.map((tab) => {
      const isActive = activeTab === tab.id;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={isActive ? 'page' : undefined}
          className={`relative shrink-0 px-3.5 md:px-5 h-12 md:h-[52px] text-[14px] md:text-[15px] whitespace-nowrap tracking-[-0.02em] transition-colors duration-150 ${
            isActive ? 'text-ink font-bold' : 'text-ink-mute font-semibold hover:text-ink-soft'
          }`}
        >
          {tab.label}
          <span
            aria-hidden="true"
            className={`absolute left-2.5 right-2.5 bottom-0 h-[2px] rounded-full bg-brand transition-all duration-200 ${
              isActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
            }`}
            style={isActive ? { boxShadow: '0 2px 10px -2px var(--color-brand)' } : undefined}
          />
        </button>
      );
    })}
  </nav>
);

export default TabNav;
