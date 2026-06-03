export const DEFAULT_PORTFOLIO_NAME = '투자 통합 대시보드';
export const PORTFOLIO_NAME_STORAGE_KEY = 'portfolio_name_v1';
export const ASSETS_STORAGE_KEY = 'portfolio_assets_v17';
export const TRADES_STORAGE_KEY = 'portfolio_trades_v17';
export const MEMOS_STORAGE_KEY = 'portfolio_trade_memos_v1';
export const TRADE_LEDGER_STORAGE_KEY = 'portfolio_trade_ledger_v1';
export const AUTO_DIVIDENDS_STORAGE_KEY = 'portfolio_auto_dividends_v1';
export const TARGET_PORTFOLIO_STORAGE_KEY = 'portfolio_target_plan_v1';

export const ASSET_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#eab308',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#0ea5e9',
  '#d946ef',
  '#22c55e',
  '#f43f5e',
  '#a855f7',
  '#64748b',
  '#fb7185',
  '#2dd4bf',
  '#c084fc',
  '#fb923c',
  '#38bdf8',
  '#a3e635',
];

export const CATEGORY_COLORS = {
  현금: '#facc15',
  국내주식: '#ef4444',
  해외주식: '#2563eb',
  원자재: '#111827',
};

export const DETAIL_CHART_COLORS = [
  '#059669',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#0f766e',
  '#9333ea',
  '#65a30d',
  '#c026d3',
  '#b45309',
  '#0d9488',
  '#86198f',
  '#4d7c0f',
  '#be185d',
  '#0e7490',
  '#6d28d9',
  '#15803d',
  '#a16207',
  '#9d174d',
  '#115e59',
];

export const getCategoryColor = (category) => CATEGORY_COLORS[String(category || '').trim()] || '#94a3b8';

export const getDetailChartColor = (fallbackIndex = 0) => DETAIL_CHART_COLORS[fallbackIndex % DETAIL_CHART_COLORS.length];

export const getAssetColor = (key = '', fallbackIndex = 0) => {
  const normalizedKey = String(key).trim();
  if (!normalizedKey) return ASSET_COLORS[fallbackIndex % ASSET_COLORS.length];

  let hash = 0;
  for (let index = 0; index < normalizedKey.length; index += 1) {
    hash = (hash * 31 + normalizedKey.charCodeAt(index)) >>> 0;
  }

  return ASSET_COLORS[hash % ASSET_COLORS.length];
};
