export const DEFAULT_PORTFOLIO_NAME = '투자 통합 대시보드';
export const PORTFOLIO_NAME_STORAGE_KEY = 'portfolio_name_v1';
export const ASSETS_STORAGE_KEY = 'portfolio_assets_v17';
export const TRADES_STORAGE_KEY = 'portfolio_trades_v17';
export const MEMOS_STORAGE_KEY = 'portfolio_trade_memos_v1';
export const TRADE_LEDGER_STORAGE_KEY = 'portfolio_trade_ledger_v1';
export const AUTO_DIVIDENDS_STORAGE_KEY = 'portfolio_auto_dividends_v1';
export const DIVIDEND_ASSET_REGISTRY_STORAGE_KEY = 'portfolio_dividend_asset_registry_v1';
export const TARGET_PORTFOLIO_STORAGE_KEY = 'portfolio_target_plan_v1';
export const PRIVACY_MODE_STORAGE_KEY = 'portfolio_privacy_mode_v1';

export const ASSET_COLORS = [
  '#334155',
  '#475569',
  '#64748b',
  '#0f766e',
  '#b45309',
  '#7c3aed',
  '#be123c',
  '#0369a1',
];

export const CATEGORY_COLORS = {
  현금: '#d6a21d',
  국내주식: '#e05555',
  해외주식: '#4169e1',
  원자재: '#273445',
};

export const DETAIL_CHART_COLORS = [
  '#334155',
  '#475569',
  '#64748b',
  '#0f766e',
  '#b45309',
  '#7c3aed',
  '#be123c',
  '#0369a1',
];

export const CATEGORY_DETAIL_COLOR_SCALES = {
  국내주식: [
    '#450a0a',
    '#7f1d1d',
    '#991b1b',
    '#b91c1c',
    '#dc2626',
    '#ef4444',
    '#f87171',
    '#fca5a5',
    '#fecaca',
    '#fee2e2',
    '#fff1f2',
    '#fffafa',
  ],
  해외주식: [
    '#1e3a8a',
    '#1e40af',
    '#1d4ed8',
    '#2563eb',
    '#2f6ff0',
    '#3b82f6',
    '#4b8df7',
    '#60a5fa',
    '#70b0fb',
    '#82bafa',
    '#93c5fd',
    '#a4cdfd',
    '#b1d4fe',
    '#bfdbfe',
    '#c9e2fe',
    '#d3e8ff',
    '#dbeafe',
    '#e0edff',
    '#e5f0ff',
    '#eaf3ff',
    '#eff6ff',
    '#f3f8ff',
    '#f7fbff',
    '#fbfdff',
  ],
  현금: [
    '#a16207',
    '#ca8a04',
    '#eab308',
    '#facc15',
  ],
  원자재: [
    '#111827',
    '#273445',
    '#475569',
    '#64748b',
  ],
};

const CATEGORY_DETAIL_HSL = {
  국내주식: { hue: 0, saturation: 68, startLightness: 30, step: 3.7, range: 46 },
  해외주식: { hue: 220, saturation: 78, startLightness: 30, step: 3.5, range: 48 },
  현금: { hue: 43, saturation: 76, startLightness: 38, step: 4.5, range: 36 },
  원자재: { hue: 215, saturation: 22, startLightness: 18, step: 4, range: 38 },
};

export const getCategoryColor = (category) => CATEGORY_COLORS[String(category || '').trim()] || '#94a3b8';

export const getDetailChartColor = (fallbackIndex = 0) => DETAIL_CHART_COLORS[fallbackIndex % DETAIL_CHART_COLORS.length];

export const getCategoryDetailColor = (category, rankIndex = 0) => {
  const normalizedCategory = String(category || '').trim();
  const scale = CATEGORY_DETAIL_COLOR_SCALES[normalizedCategory];
  if (!scale) return getDetailChartColor(rankIndex);
  if (rankIndex < scale.length) return scale[rankIndex];

  const hsl = CATEGORY_DETAIL_HSL[normalizedCategory];
  if (!hsl) return scale[rankIndex % scale.length];

  const overflowIndex = rankIndex - scale.length;
  const lightness = hsl.startLightness + ((overflowIndex * hsl.step) % hsl.range);
  const hueShift = Math.floor(overflowIndex / Math.ceil(hsl.range / hsl.step)) % 2 === 0 ? 0 : 6;
  return `hsl(${hsl.hue + hueShift} ${hsl.saturation}% ${lightness}%)`;
};

export const getAssetColor = (key = '', fallbackIndex = 0) => {
  const normalizedKey = String(key).trim();
  if (!normalizedKey) return ASSET_COLORS[fallbackIndex % ASSET_COLORS.length];

  let hash = 0;
  for (let index = 0; index < normalizedKey.length; index += 1) {
    hash = (hash * 31 + normalizedKey.charCodeAt(index)) >>> 0;
  }

  return ASSET_COLORS[hash % ASSET_COLORS.length];
};
