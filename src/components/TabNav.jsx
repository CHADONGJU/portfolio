const TABS = ['portfolio', 'history'];

const TabNav = ({ activeTab, onChange }) => (
  <nav className="flex gap-2 p-1.5 bg-slate-200/50 rounded-2xl w-fit border border-slate-100">
    {TABS.map((tab) => (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className={`px-6 md:px-8 py-3 md:py-3.5 rounded-xl font-black text-[11px] md:text-xs transition-all ${activeTab === tab ? 'bg-white text-blue-600 shadow-sm scale-105' : 'text-slate-400 hover:text-slate-700'}`}
      >
        {tab === 'portfolio' ? '내 포트폴리오' : '수익 및 배당 기록'}
      </button>
    ))}
  </nav>
);

export default TabNav;
