const TABS = [
  { id: 'portfolio', label: '내 포트폴리오' },
  { id: 'history', label: '수익 및 배당 기록' },
  { id: 'target', label: '목표 포트폴리오' },
  { id: 'notes', label: '메모장' },
];

const TabNav = ({ activeTab, onChange }) => (
  <nav className="flex gap-2 p-1.5 bg-slate-200/50 rounded-2xl w-full md:w-fit border border-slate-100 overflow-x-auto max-w-full">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onChange(tab.id)}
        className={`shrink-0 px-4 md:px-8 py-3 md:py-3.5 rounded-xl font-bold text-[11px] md:text-xs transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
      >
        {tab.label}
      </button>
    ))}
  </nav>
);

export default TabNav;
