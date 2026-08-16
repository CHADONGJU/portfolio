export const DEFAULT_PORTFOLIO_NAME = '주식 포트폴리오';

// 예전 기본 이름. 저장된 값이 이 중 하나면 새 기본 이름으로 갈아끼운다.
// (사용자가 직접 지은 이름은 그대로 둔다.)
export const LEGACY_PORTFOLIO_NAMES = ['투자 통합 대시보드'];
export const PORTFOLIO_NAME_STORAGE_KEY = 'portfolio_name_v1';
export const ASSETS_STORAGE_KEY = 'portfolio_assets_v17';
export const TRADES_STORAGE_KEY = 'portfolio_trades_v17';
export const MEMOS_STORAGE_KEY = 'portfolio_trade_memos_v1';
export const TRADE_LEDGER_STORAGE_KEY = 'portfolio_trade_ledger_v1';
export const AUTO_DIVIDENDS_STORAGE_KEY = 'portfolio_auto_dividends_v1';
export const CONFIRMED_DIVIDENDS_STORAGE_KEY = 'portfolio_confirmed_dividends_v1';
export const DIVIDEND_ASSET_REGISTRY_STORAGE_KEY = 'portfolio_dividend_asset_registry_v1';
export const TARGET_PORTFOLIO_STORAGE_KEY = 'portfolio_target_plan_v1';

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
  /*
   * 밝은 쪽 끝을 잘라냈다. 예전 마지막 색(#fffafa)은 흰 카드 배경 대비 1.03:1이라
   * 비중이 작은 종목이 배경과 구분되지 않는 흰 조각으로 보였다. 범례 색상칩이
   * 유일한 식별 수단이라 색이 안 보이면 정보 자체가 사라진다.
   * 여기 있는 색은 모두 흰 배경 대비 1.9:1 이상, 이웃 색과 1.28:1 이상 차이가 난다.
   * 이 개수를 넘는 종목은 아래 HSL 생성기가 이어서 만든다.
   */
  국내주식: [
    '#450a0a',
    '#7f1d1d',
    '#b91c1c',
    '#dc2626',
    '#ef4444',
    '#f87171',
    '#fca5a5',
  ],
  해외주식: [
    '#1e3a8a',
    '#1e40af',
    '#1d4ed8',
    '#2563eb',
    '#3b82f6',
    '#60a5fa',
    '#93c5fd',
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
  해외주식: { hue: 220, saturation: 78, startLightness: 30, step: 3.5, range: 44 },
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
