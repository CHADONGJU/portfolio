const TABS = [
  { id: 'portfolio', label: '내 포트폴리오' },
  { id: 'history', label: '수익 및 배당 기록' },
  { id: 'target', label: '목표 포트폴리오' },
  { id: 'notes', label: '메모장' },
  { id: 'calendar', label: '캘린더' },
];

const TabNav = ({ activeTab, onChange }) => (
  <nav className="flex gap-1.5 p-1 bg-white rounded-2xl w-full md:w-fit border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-x-auto max-w-full">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onChange(tab.id)}
        className={`shrink-0 px-3 md:px-7 py-2.5 md:py-3 rounded-xl font-bold text-[10px] md:text-xs transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
      >
        {tab.label}
      </button>
    ))}
  </nav>
);

export default TabNav;
