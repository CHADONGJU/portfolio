import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Minus, TrendingUp, TrendingDown, Trash2,
  PieChart as PieIcon,
  Receipt, Wallet, ArrowLeft, X, Banknote, DollarSign, ArrowRightLeft, Search, Folder, Target, CalendarDays
} from 'lucide-react';
import DashboardHeader from './components/DashboardHeader';
import SyncStatusToast from './components/SyncStatusToast';
import TabNav from './components/TabNav';
import { useAuth } from './context/useAuth';
import {
  AUTO_DIVIDENDS_STORAGE_KEY,
  ASSETS_STORAGE_KEY,
  CONFIRMED_DIVIDENDS_STORAGE_KEY,
  DEFAULT_PORTFOLIO_NAME,
  DIVIDEND_ASSET_REGISTRY_STORAGE_KEY,
  getCategoryColor,
  getCategoryDetailColor,
  MEMOS_STORAGE_KEY,
  PORTFOLIO_NAME_STORAGE_KEY,
  PRIVACY_MODE_STORAGE_KEY,
  TARGET_PORTFOLIO_STORAGE_KEY,
  TRADE_LEDGER_STORAGE_KEY,
  TRADES_STORAGE_KEY,
} from './constants';
import {
  fetchBitcoinPrices,
  fetchDividends,
  fetchKrwRate,
  fetchStockQuote,
  fetchTradingViewQuotes,
  fetchUsdKrwRate,
} from './services/marketData';
import {
  loadPortfolioState,
  migratePortfolioState,
  savePortfolioStateDiff,
  subscribePortfolioState,
} from './services/portfolioStore';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from './utils/formatters';
import { loadJson, saveJson } from './utils/storage';
import { createRefreshCoordinator } from './utils/refreshCoordinator';
import { createPortfolioBackup, parsePortfolioBackup } from './utils/portfolioBackup';
import {
  buildCanonicalTradeRows,
  buildPositionFromTradeRows,
  reconcileAssetsWithTradeLedger,
} from './utils/tradeReconciliation';
import {
  buildAutoDividendRows,
  getAssetBuyLedgerRows,
  getAssetDividendProfile,
  getAssetLedgerRows,
  getDateTimestampSeconds,
  getDividendStartDate,
  getHeldQuantityOnExDate,
  isVerifiableDividendRecord,
  recalculateEstimatedDividendRow,
  selectReportedDividendRecords,
} from './utils/dividendCalculations';
import {
  mergeDividendAssetRegistry,
  mergeDividendResultsByAsset,
  mergeUniqueDividends,
} from './utils/dividendSync';
import { usePortfolioMetrics } from './hooks/usePortfolioMetrics';
import { db } from './firebase';

const MemoTab = React.lazy(() => import('./components/MemoTab'));

const isDomesticStockCategory = (category) => category?.includes('국내') && category?.includes('주식');
const isCommodityCategory = (category) => category?.includes('원자재');
const isDomesticQuoteAsset = (asset = {}) => (
  isDomesticStockCategory(asset.category)
  || (
    asset.currency === 'KRW'
    && /^\d{5,6}(\.(KS|KQ))?$/i.test(String(asset.ticker || '').trim())
  )
);

const TRADE_SORT_OPTIONS = [
  { value: 'newest', label: '최신 날짜 우선' },
  { value: 'oldest', label: '가장 오래된 날짜 우선' },
  { value: 'profit-desc', label: '실현 손익(이득 큰 순)' },
  { value: 'profit-asc', label: '실현 손익(손해 큰 순)' },
];
const TRADE_PAGE_SIZE = 10;
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const parseNumber = (value) => parseFloat(String(value || '').replace(/,/g, '')) || 0;
const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (date, months) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};
const buildCalendarCells = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const start = new Date(firstDay);
  start.setDate(start.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      dateKey: formatDateKey(date),
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === month - 1,
    };
  });
};
const getRecordDate = (record) => record.sellDate || record.date || record.buyDate || '';
const getRecordPnl = (record) => Number(record.pnl ?? record.realizedPnl ?? 0);
const getTradeSide = (record) => {
  if (record.side === 'buy' || record.type === 'buy') return 'buy';
  if (record.side === 'sell' || record.type === 'sell') return 'sell';
  if (record.action === '매수') return 'buy';
  if (record.action === '매도') return 'sell';
  if (record.sellDate || getRecordPnl(record) !== 0) return 'sell';
  return 'buy';
};
const normalizeTradeAction = (record) => {
  return getTradeSide(record) === 'sell' ? '매도' : '매수';
};

const numbersMatch = (left, right) => Math.abs(parseNumber(left) - parseNumber(right)) < 0.0001;
const findMatchingSellTrade = (memo, trades) => trades.find((trade) => {
  if (!memo.name || memo.name !== trade.name) return false;
  if (!memo.date || memo.date !== trade.sellDate) return false;
  if (parseNumber(memo.quantity) && !numbersMatch(memo.quantity, trade.quantity)) return false;
  if (parseNumber(memo.price) && !numbersMatch(memo.price, trade.sellPrice)) return false;
  return true;
});

const findMatchingMemoForLedger = (entry, memos) => memos.find((memo) => {
  if (entry.sourceId === `memo-${memo.id}`) return true;
  if (!entry.name || entry.name !== memo.name) return false;
  if (!entry.date || entry.date !== memo.date) return false;
  if (getTradeSide(entry) !== getTradeSide(memo)) return false;
  if (parseNumber(entry.quantity) && parseNumber(memo.quantity) && !numbersMatch(entry.quantity, memo.quantity)) return false;
  if (parseNumber(entry.price) && parseNumber(memo.price) && !numbersMatch(entry.price, memo.price)) return false;
  return true;
});

const sortTradeRecords = (records, sortMode) => [...records].sort((a, b) => {
  if (sortMode === 'oldest') return new Date(getRecordDate(a)) - new Date(getRecordDate(b));
  if (sortMode === 'profit-desc') return getRecordPnl(b) - getRecordPnl(a);
  if (sortMode === 'profit-asc') return getRecordPnl(a) - getRecordPnl(b);
  return new Date(getRecordDate(b)) - new Date(getRecordDate(a));
});

  const buildTradeSummary = (records, exchangeRate = 1, yenRate = 1, rates = {}) => records.reduce((summary, record) => {
  const quantity = Number(record.quantity) || 0;
  const action = normalizeTradeAction(record);
  const pnl = getRecordPnl(record);
  const pnlKRW = pnl * getCachedKrwRate(record.currency, rates, exchangeRate, yenRate);

  if (action === '매수') {
    summary.totalBuyQuantity += quantity;
    summary.totalBuyCount += 1;
  }
  if (action === '매도') {
    summary.totalSellQuantity += quantity;
    summary.totalSellCount += 1;
  }
  summary.totalProfit += pnlKRW;

  return summary;
}, {
  totalBuyQuantity: 0,
  totalSellQuantity: 0,
  totalBuyCount: 0,
  totalSellCount: 0,
  totalProfit: 0,
});

const DEFAULT_TARGET_PORTFOLIO = {
  budget: '',
  categories: [
    { id: '국내주식', percent: 30 },
    { id: '해외주식', percent: 50 },
    { id: '현금', percent: 20 },
  ],
  items: {
    국내주식: [],
    해외주식: [],
    현금: [],
  },
  groups: {
    국내주식: [],
    해외주식: [],
    현금: [],
  },
};

const buildLedgerEntry = ({
  sourceId,
  asset,
  side,
  quantity,
  price,
  date,
  pnl = 0,
  pnlKRW = 0,
}) => {
  const dividendProfile = getAssetDividendProfile(asset);

  return {
    id: sourceId || `${Date.now()}-${Math.random()}`,
    sourceId,
    assetId: asset.id ?? asset.assetId ?? null,
    name: asset.name,
    ticker: asset.ticker || '',
    category: asset.category || '',
    currency: asset.currency || 'KRW',
    accountName: asset.accountName || '',
    accountType: asset.accountType || dividendProfile.accountType,
    sourceCountry: asset.sourceCountry || dividendProfile.sourceCountry,
    securityType: asset.securityType || dividendProfile.securityType,
    dividendTaxRate: Number(asset.dividendTaxRate ?? dividendProfile.dividendTaxRate) || 0,
    dividendTaxRateExplicit: asset.dividendTaxRateExplicit === true,
    dividendTaxBasisPerShare: Number(asset.dividendTaxBasisPerShare ?? dividendProfile.dividendTaxBasisPerShare) || 0,
    adrFeePerShare: Number(asset.adrFeePerShare ?? dividendProfile.adrFeePerShare) || 0,
    adrFeePerShareExplicit: asset.adrFeePerShareExplicit === true,
    side,
    action: side === 'sell' ? '매도' : '매수',
    quantity: Number(quantity) || 0,
    price: Number(price) || 0,
    date,
    pnl: Number(pnl) || 0,
    pnlKRW: Number(pnlKRW) || 0,
    createdAt: new Date().toISOString(),
  };
};

const buildInitialTradeLedger = ({ assets, trades, memos }) => {
  const entries = [];
  const pushOnce = (entry) => {
    if (!entry.name || !entry.date) return;
    if (entries.some((item) => item.sourceId === entry.sourceId)) return;
    entries.push(entry);
  };

  memos.forEach((memo) => {
    pushOnce(buildLedgerEntry({
      sourceId: `memo-${memo.id}`,
      asset: memo,
      side: getTradeSide(memo),
      quantity: memo.quantity,
      price: memo.price,
      date: memo.date,
      pnl: getRecordPnl(memo),
    }));
  });

  trades.forEach((trade) => {
    pushOnce(buildLedgerEntry({
      sourceId: `trade-${trade.id}`,
      asset: trade,
      side: 'sell',
      quantity: trade.quantity,
      price: trade.sellPrice,
      date: trade.sellDate,
      pnl: trade.pnl,
    }));
  });

  assets.forEach((asset) => {
    const alreadyHasBuy = entries.some((entry) => (
      entry.side === 'buy'
      && entry.name === asset.name
      && entry.date === asset.buyDate
      && numbersMatch(entry.quantity, asset.quantity)
    ));
    if (alreadyHasBuy || !asset.buyDate || asset.category === '현금') return;

    pushOnce(buildLedgerEntry({
      sourceId: `asset-${asset.id}`,
      asset,
      side: 'buy',
      quantity: asset.quantity,
      price: asset.originalAveragePrice || asset.averagePrice,
      date: asset.buyDate,
    }));
  });

  return entries.sort((a, b) => new Date(b.date) - new Date(a.date));
};

const getAssetIdentity = (asset) => `${asset.ticker || ''}::${asset.name || ''}`;

const getAssetUpdatedAtTime = (asset = {}) => {
  const timestamp = new Date(asset.updatedAt || asset.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareAssetVersions = (left = {}, right = {}) => {
  const leftTime = getAssetUpdatedAtTime(left);
  const rightTime = getAssetUpdatedAtTime(right);
  if (leftTime !== rightTime) return leftTime - rightTime;

  return parseNumber(left.quantity) - parseNumber(right.quantity);
};

const mergeUniqueAssets = (primary = [], secondary = []) => {
  const assetByKey = new Map();

  [...primary, ...secondary].forEach((asset) => {
    const key = getAssetIdentity(asset);
    const existing = assetByKey.get(key);
    if (!existing || compareAssetVersions(existing, asset) <= 0) {
      assetByKey.set(key, asset);
    }
  });

  return [...assetByKey.values()];
};

const mergeUniqueRecords = (primary = [], secondary = []) => {
  const seen = new Set();
  return [...primary, ...secondary].filter((record) => {
    const key = [
      record.id || '',
      record.sourceId || '',
      record.name || '',
      record.ticker || '',
      record.side || record.action || '',
      record.date || record.buyDate || record.sellDate || '',
      record.quantity || '',
      record.price || record.buyPrice || record.sellPrice || '',
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const recalculateDividendRowsForAssets = (dividends = [], assets = [], ledger = []) => dividends.flatMap((dividend) => {
  const dividendTicker = String(dividend.ticker || '').toUpperCase().trim();
  const asset = assets.find((candidate) => (
    (
      dividend.assetId !== undefined
      && dividend.assetId !== null
      && String(candidate.id) === String(dividend.assetId)
    )
    || (
      dividendTicker
      && String(candidate.ticker || '').toUpperCase().trim() === dividendTicker
    )
    || (
      dividend.name
      && candidate.name === dividend.name
    )
  ));

  if (!asset) return [];

  const exDate = dividend.exDate || dividend.date || '';
  const dividendStartDate = getDividendStartDate(asset, ledger);
  const ledgerQuantity = exDate
    ? getHeldQuantityOnExDate(asset, ledger, exDate)
    : 0;
  if (!dividendStartDate || !exDate || ledgerQuantity <= 0) return [];

  const recalculated = recalculateEstimatedDividendRow(
    { ...dividend, quantity: ledgerQuantity },
    asset,
  );
  return isVerifiableDividendRecord(recalculated) ? [recalculated] : [];
});

const isRecordForAsset = (record, asset) => {
  if (!record || !asset) return false;
  const assetId = String(asset.id);
  const recordAssetId = record.assetId === undefined || record.assetId === null ? '' : String(record.assetId);
  if (recordAssetId && recordAssetId === assetId) return true;
  if (record.sourceId === `asset-${asset.id}`) return true;

  const sameTicker = asset.ticker && record.ticker && String(record.ticker).toUpperCase() === String(asset.ticker).toUpperCase();
  const sameName = asset.name && record.name && record.name === asset.name;
  return Boolean(sameTicker || sameName);
};

const isTradeLinkedToLedger = (trade, ledger = []) => ledger.some((entry) => (
  getTradeSide(entry) === 'sell'
  && trade.name === entry.name
  && (!trade.ticker || !entry.ticker || String(trade.ticker).toUpperCase() === String(entry.ticker).toUpperCase())
  && trade.sellDate === getRecordDate(entry)
  && numbersMatch(trade.quantity, entry.quantity)
  && numbersMatch(trade.sellPrice, entry.price)
));

const compactPortfolioSnapshot = (snapshot = {}) => {
  const tradeLedger = mergeUniqueRecords(Array.isArray(snapshot.tradeLedger) ? snapshot.tradeLedger : []);
  const rawTrades = mergeUniqueRecords(Array.isArray(snapshot.trades) ? snapshot.trades : []);
  const trades = tradeLedger.length > 0
    ? rawTrades.filter((trade) => isTradeLinkedToLedger(trade, tradeLedger))
    : rawTrades;
  const assets = reconcileAssetsWithTradeLedger(
    mergeUniqueAssets(Array.isArray(snapshot.assets) ? snapshot.assets : []),
    tradeLedger,
  );
  const autoDividends = recalculateDividendRowsForAssets(
    mergeUniqueDividends(Array.isArray(snapshot.autoDividends) ? snapshot.autoDividends : []),
    assets,
    tradeLedger,
  );
  return {
    ...snapshot,
    assets,
    trades,
    memos: mergeUniqueRecords(Array.isArray(snapshot.memos) ? snapshot.memos : []),
    tradeLedger,
    autoDividends,
    confirmedDividends: mergeUniqueDividends(
      Array.isArray(snapshot.confirmedDividends) ? snapshot.confirmedDividends : [],
    ),
    dividendAssetRegistry: mergeDividendAssetRegistry(Array.isArray(snapshot.dividendAssetRegistry) ? snapshot.dividendAssetRegistry : [], [], assets),
    targetPortfolio: snapshot.targetPortfolio || DEFAULT_TARGET_PORTFOLIO,
    portfolioName: typeof snapshot.portfolioName === 'string' && snapshot.portfolioName.trim()
      ? snapshot.portfolioName
      : DEFAULT_PORTFOLIO_NAME,
  };
};

const getTargetGroups = (targetPortfolio, categoryId) => {
  const savedGroups = targetPortfolio.groups?.[categoryId] || [];
  const legacyItems = targetPortfolio.items?.[categoryId] || [];

  if (savedGroups.length > 0) {
    return savedGroups.map((group) => ({
      ...group,
      items: group.items || [],
    }));
  }

  if (legacyItems.length > 0) {
    return [{
      id: `${categoryId}-default-group`,
      name: '직접 설정',
      percent: 100,
      items: legacyItems,
    }];
  }

  return [];
};

const normalizeInputTicker = (ticker = '') => String(ticker)
  .toUpperCase()
  .trim()
  .replace(/^TYO:/, '')
  .replace(/^TSE:/, '')
  .replace(/^JP:/, '')
  .replace(/\.JP$/, '.T')
  .replace(/\.TYO$/, '.T')
  .replace(/\s+/g, '');

const getCurrencySymbol = (currency) => ({ USD: '$', JPY: '¥', KRW: '₩' }[currency] || currency);

const isJapaneseTicker = (ticker = '') => /^\d{4}(\.T)?$/.test(normalizeInputTicker(ticker));

const getTargetItemCurrency = (categoryId, ticker = '', savedCurrency = '') => {
  if (categoryId === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (savedCurrency && savedCurrency !== 'USD') return savedCurrency;
  if (normalizeInputTicker(ticker).includes('.')) return savedCurrency || '';
  return categoryId === '해외주식' || categoryId === '원자재' ? 'USD' : 'KRW';
};

const getAssetInputCurrency = (category, ticker = '', savedCurrency = '') => {
  if (category === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (category === '해외주식' && normalizeInputTicker(ticker).includes('.') && savedCurrency) return savedCurrency;
  if (category === '해외주식' || category === '원자재') return 'USD';
  return 'KRW';
};

const isSameAssetRecord = (asset, record) => {
  const assetTicker = normalizeInputTicker(asset.ticker);
  const recordTicker = normalizeInputTicker(record.ticker);

  return Boolean(
    (asset.id && record.assetId && asset.id === record.assetId)
    || (assetTicker && recordTicker && assetTicker === recordTicker)
    || (asset.name && record.name && asset.name === record.name)
  );
};

const getAssetIdentityKey = (asset = {}) => {
  if (asset.id !== undefined && asset.id !== null) return `id:${asset.id}`;
  return [
    normalizeInputTicker(asset.ticker || ''),
    asset.name || '',
    asset.category || '',
  ].join('::');
};

const getNativePriceValue = (asset = {}) => (
  parseNumber(asset.originalCurrentPrice) || parseNumber(asset.currentPrice)
);

const getQuoteSourceLabel = (source = '') => ({
  naver: 'NAVER',
  tradingview: 'TradingView',
  yahoo: 'Yahoo',
  stooq: 'Stooq',
  coingecko: 'CoinGecko',
  cash: '고정값',
}[source] || source || '시세');

const getQuoteStatusMeta = (asset = {}) => {
  if (asset.quoteSyncState === 'error') {
    return { label: '갱신 실패', className: 'text-rose-500', dotClassName: 'bg-rose-500' };
  }
  if (asset.quoteSyncState === 'cached') {
    return { label: '직전 가격', className: 'text-amber-600', dotClassName: 'bg-amber-500' };
  }
  if (asset.quoteSyncState !== 'success') {
    return { label: '갱신 대기', className: 'text-slate-400', dotClassName: 'bg-slate-300' };
  }
  const session = String(asset.quoteSession || '').toUpperCase();
  const delayMinutes = session.match(/DELAYED_(\d+)_MIN/)?.[1];
  const sessionLabel = session.includes('POST_MARKET') || session.includes('AFTER_MARKET')
    ? '시간외'
    : session.includes('PRE_MARKET')
      ? '장전'
      : '';

  if (sessionLabel || delayMinutes) {
    return {
      label: [sessionLabel, delayMinutes ? `${delayMinutes}분 지연` : ''].filter(Boolean).join(' · '),
      className: 'text-amber-600',
      dotClassName: 'bg-amber-500',
    };
  }
  return { label: '최신 시세', className: 'text-emerald-600', dotClassName: 'bg-emerald-500' };
};

const formatQuoteTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isSuspiciousLivePriceUpdate = (currentAsset = {}, updatedAsset = {}) => {
  if (['naver', 'tradingview', 'yahoo', 'stooq', 'coingecko'].includes(updatedAsset.quoteSource)) return false;

  const currentPrice = getNativePriceValue(currentAsset);
  const nextPrice = getNativePriceValue(updatedAsset);
  if (currentPrice <= 0 || nextPrice <= 0) return false;

  const ratio = Math.max(currentPrice / nextPrice, nextPrice / currentPrice);
  return ratio >= 8;
};

const mergeLiveAssetUpdates = (currentAssets = [], refreshedAssets = []) => {
  const refreshedByKey = new Map(
    refreshedAssets.map((asset) => [getAssetIdentityKey(asset), asset])
  );

  return mergeUniqueAssets(currentAssets.map((asset) => {
    const refreshed = refreshedByKey.get(getAssetIdentityKey(asset));
    if (!refreshed || isSuspiciousLivePriceUpdate(asset, refreshed)) return asset;

    return {
      ...asset,
      currency: refreshed.currency,
      originalCurrency: refreshed.originalCurrency,
      currentPrice: refreshed.currentPrice,
      originalCurrentPrice: refreshed.originalCurrentPrice,
      quoteSource: refreshed.quoteSource,
      quoteSession: refreshed.quoteSession,
      quoteUpdatedAt: refreshed.quoteUpdatedAt,
      quoteSyncState: refreshed.quoteSyncState,
      quoteSyncMessage: refreshed.quoteSyncMessage,
    };
  }));
};

const getAssetCategoryOrder = (category = '') => {
  const normalizedCategory = String(category || '').trim();
  if (normalizedCategory === '국내주식') return 10;
  if (normalizedCategory === '해외주식') return 20;
  if (normalizedCategory === '원자재') return 30;
  if (normalizedCategory === '가상화폐') return 40;
  if (normalizedCategory === '현금') return 50;
  return 90;
};

const getCachedKrwRate = (currency, rates = {}, usdRate = 0, yenRate = 0) => {
  const code = String(currency || 'KRW').toUpperCase();
  if (code === 'USD') return Number(usdRate) > 0 ? Number(usdRate) : Number(rates.USD) || 0;
  if (code === 'JPY') return Number(yenRate) > 0 ? Number(yenRate) : Number(rates.JPY) || 0;
  if (code !== 'KRW') return Number(rates[code]) || 0;
  return 1;
};

const getTargetItemSnapshotKey = (targetPortfolio) => targetPortfolio.categories
  .flatMap(category => getTargetGroups(targetPortfolio, category.id).flatMap(group => (
    (group.items || []).map(item => `${category.id}:${group.id}:${item.id}:${item.ticker || ''}:${item.price || ''}:${item.nativePrice || ''}`)
  )))
  .join('|');

const emptyPortfolioSnapshot = () => ({
  portfolioName: DEFAULT_PORTFOLIO_NAME,
  assets: [],
  trades: [],
  memos: [],
  tradeLedger: [],
  autoDividends: [],
  confirmedDividends: [],
  dividendAssetRegistry: [],
  targetPortfolio: DEFAULT_TARGET_PORTFOLIO,
});

const App = () => {
  const { user, signOutUser } = useAuth();
  const userId = user?.uid || '';
  const userEmail = user?.email || '';
  // 1. 상태 관리
  const [exchangeRate, setExchangeRate] = useState(0); 
  const [jpyKrwRate, setJpyKrwRate] = useState(0);
  const [currencyRates, setCurrencyRates] = useState({ KRW: 1 });
  const [isLiveMode] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState('portfolio');
  const [privacyMode, setPrivacyMode] = useState(() => loadJson(PRIVACY_MODE_STORAGE_KEY, false));
  const [isFetching, setIsFetching] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ label: '', completed: 0, total: 0 });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isCloudPortfolioLoaded, setIsCloudPortfolioLoaded] = useState(!user || !db);
  const [cloudPortfolioUserId, setCloudPortfolioUserId] = useState('');

  // 피드백 로그 (3초 뒤 자동 삭제)
  const [syncStatus, setSyncStatus] = useState([]);
  const addLog = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setSyncStatus(prev => {
      if (prev.some(log => log.msg === msg && log.type === type)) return prev;
      return [{ id, msg, type }, ...prev].slice(0, 3);
    });
    setTimeout(() => {
      setSyncStatus(prev => prev.filter(log => log.id !== id));
    }, 3000);
  };

  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedDividendAsset, setSelectedDividendAsset] = useState(null);
  const [dividendFilter, setDividendFilter] = useState('전체');
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey(new Date()));
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState('');

  const [isAdding, setIsAdding] = useState(false);
  const defaultBuyDate = new Date().toISOString().split('T')[0];
  const [tradeSortMode, setTradeSortMode] = useState('newest');
  const [tradeStockFilter, setTradeStockFilter] = useState('all');
  const [tradeVisibleCount, setTradeVisibleCount] = useState(TRADE_PAGE_SIZE);
  const [performanceSearchTerm, setPerformanceSearchTerm] = useState('');
  const [memoSortMode, setMemoSortMode] = useState('newest');
  const [memoStockFilter, setMemoStockFilter] = useState('all');
  const [targetViewMode, setTargetViewMode] = useState('table');
  const [selectedTargetCategory, setSelectedTargetCategory] = useState(null);
  const [selectedTargetGroup, setSelectedTargetGroup] = useState(null);
  const [targetPriceSyncStatus, setTargetPriceSyncStatus] = useState('');
  const [targetCategoryDraft, setTargetCategoryDraft] = useState('가상화폐');
  const [manualMemo, setManualMemo] = useState({
    stockName: '',
    ticker: '',
    action: '매수',
    quantity: '',
    price: '',
    date: defaultBuyDate,
    realizedPnl: '',
    currency: 'KRW',
    memo: '',
  });
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false);
  const [selectedAssetToUpdate, setSelectedAssetToUpdate] = useState(null);

  const initialAssetState = {
    name: '',
    ticker: '',
    category: '국내주식',
    currency: 'KRW',
    averagePrice: '',
    quantity: '',
    buyDate: defaultBuyDate,
    accountName: '',
    accountType: 'GENERAL',
    sourceCountry: '',
    securityType: '',
    dividendTaxRate: '',
    dividendTaxBasisPerShare: '',
    adrFeePerShare: '',
    adrFeePerShareExplicit: false,
    memo: '',
  };
  const [newAsset, setNewAsset] = useState(initialAssetState);
const initialAddBuyState = {
  quantity: '',
  averagePrice: '',
  buyDate: defaultBuyDate,
  memo: ''
};

const [addBuyForm, setAddBuyForm] = useState(initialAddBuyState);

const [isSellingAsset, setIsSellingAsset] = useState(false);
const [selectedAssetToSell, setSelectedAssetToSell] = useState(null);
const [selectedAssetToManageBuys, setSelectedAssetToManageBuys] = useState(null);
const [buyLotDrafts, setBuyLotDrafts] = useState([]);

const initialSellFormState = {
  sellPrice: '',
  quantity: '',
  sellDate: defaultBuyDate,
  memo: ''
};

const [sellForm, setSellForm] = useState(initialSellFormState);
const buyLotDraftSummary = useMemo(() => {
  const totalQuantity = buyLotDrafts.reduce((sum, lot) => sum + parseNumber(lot.quantity), 0);
  const totalCost = buyLotDrafts.reduce((sum, lot) => (
    sum + parseNumber(lot.quantity) * parseNumber(lot.price)
  ), 0);

  return {
    totalQuantity,
    averagePrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
  };
}, [buyLotDrafts]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      setIsAdding(false);
      setIsUpdatingAsset(false);
      setSelectedAssetToUpdate(null);
      setIsSellingAsset(false);
      setSelectedAssetToSell(null);
      setSelectedAssetToManageBuys(null);
      setBuyLotDrafts([]);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    const hasOpenDialog = Boolean(
      isAdding || isUpdatingAsset || isSellingAsset || selectedAssetToManageBuys,
    );
    const previousOverflow = document.body.style.overflow;
    if (hasOpenDialog) document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isAdding, isUpdatingAsset, isSellingAsset, selectedAssetToManageBuys]);

  useEffect(() => {
    const nextCurrency = getAssetInputCurrency(newAsset.category, newAsset.ticker);
    if (nextCurrency === 'USD') {
      setNewAsset(prev => ({ ...prev, currency: 'USD' }));
    } else if (nextCurrency === 'JPY') {
      setNewAsset(prev => ({ ...prev, currency: 'JPY' }));
    } else if (newAsset.category === '현금') {
      setNewAsset(prev => ({ ...prev, averagePrice: 1, ticker: '' }));
    } else {
      setNewAsset(prev => ({ ...prev, currency: 'KRW' }));
    }
  }, [newAsset.category, newAsset.ticker]);

  const [assets, setAssets] = useState(() => loadJson(ASSETS_STORAGE_KEY, []));
  const [trades, setTrades] = useState(() => loadJson(TRADES_STORAGE_KEY, []));
  const [memos, setMemos] = useState(() => loadJson(MEMOS_STORAGE_KEY, []));
  const [tradeLedger, setTradeLedger] = useState(() => loadJson(TRADE_LEDGER_STORAGE_KEY, []));
  const [portfolioName, setPortfolioName] = useState(() => loadJson(PORTFOLIO_NAME_STORAGE_KEY, DEFAULT_PORTFOLIO_NAME));
  const [targetPortfolio, setTargetPortfolio] = useState(() => loadJson(TARGET_PORTFOLIO_STORAGE_KEY, DEFAULT_TARGET_PORTFOLIO));
  const [dividendAssetRegistry, setDividendAssetRegistry] = useState(() => loadJson(DIVIDEND_ASSET_REGISTRY_STORAGE_KEY, []));
  const targetPortfolioRef = useRef(targetPortfolio);
  const targetTickerSnapshotKey = useMemo(() => (
    getTargetItemSnapshotKey(targetPortfolio)
  ), [targetPortfolio]);

  const [autoDividends, setAutoDividends] = useState(() => loadJson(AUTO_DIVIDENDS_STORAGE_KEY, []));
  const [confirmedDividends, setConfirmedDividends] = useState(() => loadJson(CONFIRMED_DIVIDENDS_STORAGE_KEY, []));
  const initialLedgerMigrationDoneRef = useRef(false);

  const portfolioSnapshot = useMemo(() => ({
    portfolioName,
    assets,
    trades,
    memos,
    tradeLedger,
    autoDividends,
    confirmedDividends,
    dividendAssetRegistry,
    targetPortfolio,
  }), [portfolioName, assets, trades, memos, tradeLedger, autoDividends, confirmedDividends, dividendAssetRegistry, targetPortfolio]);
  const cloudSnapshotRef = useRef(null);
  const cloudRevisionRef = useRef('');
  const portfolioSnapshotRef = useRef(portfolioSnapshot);
  const applyingCloudSnapshotRef = useRef(false);
  const explicitRestorePendingRef = useRef(false);

  useEffect(() => {
    portfolioSnapshotRef.current = portfolioSnapshot;
  }, [portfolioSnapshot]);

  useEffect(() => { saveJson(ASSETS_STORAGE_KEY, assets); }, [assets]);
  useEffect(() => { saveJson(TRADES_STORAGE_KEY, trades); }, [trades]);
  useEffect(() => { saveJson(MEMOS_STORAGE_KEY, memos); }, [memos]);
  useEffect(() => { saveJson(TRADE_LEDGER_STORAGE_KEY, tradeLedger); }, [tradeLedger]);
  useEffect(() => { saveJson(AUTO_DIVIDENDS_STORAGE_KEY, autoDividends); }, [autoDividends]);
  useEffect(() => { saveJson(CONFIRMED_DIVIDENDS_STORAGE_KEY, confirmedDividends); }, [confirmedDividends]);
  useEffect(() => { saveJson(DIVIDEND_ASSET_REGISTRY_STORAGE_KEY, dividendAssetRegistry); }, [dividendAssetRegistry]);
  useEffect(() => { saveJson(PORTFOLIO_NAME_STORAGE_KEY, portfolioName); }, [portfolioName]);
  useEffect(() => { saveJson(TARGET_PORTFOLIO_STORAGE_KEY, targetPortfolio); }, [targetPortfolio]);
  useEffect(() => { saveJson(PRIVACY_MODE_STORAGE_KEY, privacyMode); }, [privacyMode]);
  useEffect(() => { targetPortfolioRef.current = targetPortfolio; }, [targetPortfolio]);
  useEffect(() => {
    setAutoDividends((previousDividends) => {
      const recalculated = recalculateDividendRowsForAssets(previousDividends, assets, tradeLedger);
      return JSON.stringify(recalculated) === JSON.stringify(previousDividends)
        ? previousDividends
        : recalculated;
    });
  }, [assets, tradeLedger]);
  useEffect(() => {
    if (!userId || !db) {
      setIsCloudPortfolioLoaded(true);
      setCloudPortfolioUserId('');
      return undefined;
    }

    let cancelled = false;

    const loadCloudPortfolio = async () => {
      setIsCloudPortfolioLoaded(false);
      try {
        const cloudState = await loadPortfolioState(db, userId);

        if (cancelled) return;

        if (cloudState.exists) {
          const compactedCloudData = compactPortfolioSnapshot(cloudState.data);
          const compactedData = compactedCloudData;
          if (cloudState.needsMigration) {
            await migratePortfolioState(db, userId, compactedData, userEmail);
            if (cancelled) return;
            addLog('클라우드 저장 구조를 안전하게 최신 버전으로 이전했습니다.', 'success');
          }
          cloudSnapshotRef.current = cloudState.needsMigration ? compactedData : compactedCloudData;
          cloudRevisionRef.current = cloudState.revision || '';
          setAssets(compactedData.assets);
          setTrades(compactedData.trades);
          setMemos(compactedData.memos);
          setTradeLedger(compactedData.tradeLedger);
          setAutoDividends(compactedData.autoDividends);
          setConfirmedDividends(compactedData.confirmedDividends);
          setDividendAssetRegistry(compactedData.dividendAssetRegistry);
          setPortfolioName(compactedData.portfolioName);
          setTargetPortfolio(compactedData.targetPortfolio);
          addLog('로그인 계정의 저장 데이터를 불러왔습니다.', 'success');
        } else {
          const emptySnapshot = emptyPortfolioSnapshot();
          await migratePortfolioState(db, userId, emptySnapshot, userEmail);
          if (cancelled) return;
          cloudSnapshotRef.current = emptySnapshot;
          cloudRevisionRef.current = '';
          setAssets([]);
          setTrades([]);
          setMemos([]);
          setTradeLedger([]);
          setAutoDividends([]);
          setConfirmedDividends([]);
          setDividendAssetRegistry([]);
          setPortfolioName(DEFAULT_PORTFOLIO_NAME);
          setTargetPortfolio(DEFAULT_TARGET_PORTFOLIO);
          addLog('새 포트폴리오를 빈 상태로 시작합니다.', 'success');
        }
      } catch (error) {
        console.error('Cloud portfolio load failed:', error);
        if (!cancelled) addLog('클라우드 데이터 불러오기에 실패했습니다. 로컬 저장소로 계속합니다.', 'error');
      } finally {
        if (!cancelled) {
          setIsCloudPortfolioLoaded(true);
          setCloudPortfolioUserId(userId);
        }
      }
    };

    loadCloudPortfolio();
    return () => {
      cancelled = true;
    };
  }, [userId, userEmail]);

  useEffect(() => {
    if (!userId || !db || !isCloudPortfolioLoaded || cloudPortfolioUserId !== userId) {
      return undefined;
    }

    let cancelled = false;
    let isReloading = false;

    return subscribePortfolioState(db, userId, async ({ exists, revision }) => {
      if (cancelled || !exists || !revision || revision === cloudRevisionRef.current || isReloading) return;
      isReloading = true;
      try {
        const cloudState = await loadPortfolioState(db, userId);
        if (cancelled || !cloudState.exists) return;

        const compactedData = compactPortfolioSnapshot(cloudState.data);
        const currentData = compactPortfolioSnapshot(portfolioSnapshotRef.current);
        cloudSnapshotRef.current = compactedData;
        cloudRevisionRef.current = cloudState.revision || revision;

        const stateFields = [
          'portfolioName',
          'assets',
          'trades',
          'memos',
          'tradeLedger',
          'autoDividends',
          'confirmedDividends',
          'dividendAssetRegistry',
          'targetPortfolio',
        ];
        const pickState = (snapshot) => Object.fromEntries(
          stateFields.map((field) => [field, snapshot[field]]),
        );
        if (JSON.stringify(pickState(currentData)) === JSON.stringify(pickState(compactedData))) return;

        applyingCloudSnapshotRef.current = true;
        setAssets(compactedData.assets);
        setTrades(compactedData.trades);
        setMemos(compactedData.memos);
        setTradeLedger(compactedData.tradeLedger);
        setAutoDividends(compactedData.autoDividends);
        setConfirmedDividends(compactedData.confirmedDividends);
        setDividendAssetRegistry(compactedData.dividendAssetRegistry);
        setPortfolioName(compactedData.portfolioName);
        setTargetPortfolio(compactedData.targetPortfolio);
        addLog('다른 기기에서 변경된 포트폴리오를 반영했습니다.', 'success');
      } catch (error) {
        console.error('Realtime cloud portfolio reload failed:', error);
      } finally {
        isReloading = false;
      }
    }, (error) => {
      console.error('Realtime cloud portfolio subscription failed:', error);
    });
  }, [userId, userEmail, isCloudPortfolioLoaded, cloudPortfolioUserId]);

  useEffect(() => {
    if (!userId || !db || !isCloudPortfolioLoaded || cloudPortfolioUserId !== userId) return undefined;
    if (applyingCloudSnapshotRef.current) {
      applyingCloudSnapshotRef.current = false;
      return undefined;
    }

    const saveTimer = setTimeout(async () => {
      try {
        const compactedSnapshot = compactPortfolioSnapshot(portfolioSnapshot);
        await savePortfolioStateDiff(
          db,
          userId,
          compactedSnapshot,
          cloudSnapshotRef.current,
          userEmail,
          { allowDestructive: explicitRestorePendingRef.current },
        );
        cloudSnapshotRef.current = compactedSnapshot;
        explicitRestorePendingRef.current = false;
      } catch (error) {
        console.error('Cloud portfolio save failed:', error);
        const message = error?.code === 'unsafe-portfolio-shrink'
          ? '데이터가 비정상적으로 대량 감소해 클라우드 저장을 차단했습니다. 로컬 기록은 유지됩니다.'
          : error?.code === 'permission-denied'
            ? '클라우드 저장 권한이 없습니다. Firestore 규칙을 확인해주세요.'
            : '클라우드 저장에 실패했습니다. 잠시 후 다시 시도합니다.';
        addLog(message, 'error');
      }
    }, 700);

    return () => clearTimeout(saveTimer);
  }, [userId, userEmail, isCloudPortfolioLoaded, cloudPortfolioUserId, portfolioSnapshot]);

  useEffect(() => {
    if (!isCloudPortfolioLoaded) return;
    if (initialLedgerMigrationDoneRef.current) return;
    initialLedgerMigrationDoneRef.current = true;
    if (tradeLedger.length > 0) return;
    const initialLedger = buildInitialTradeLedger({ assets, trades, memos });
    if (initialLedger.length > 0) setTradeLedger(initialLedger);
  }, [isCloudPortfolioLoaded, assets, trades, memos, tradeLedger.length]);

  useEffect(() => {
    if (!isCloudPortfolioLoaded || tradeLedger.length === 0) return;
    setAssets(prevAssets => reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), tradeLedger));
  }, [isCloudPortfolioLoaded, tradeLedger]);

  // 2. 완벽한 데이터 연동 로직
  const assetsRef = useRef(assets);
  const tradeLedgerRef = useRef(tradeLedger);
  const exchangeRateRef = useRef(exchangeRate);
  const jpyKrwRateRef = useRef(jpyKrwRate);
  const currencyRatesRef = useRef(currencyRates);
  const refreshCoordinatorRef = useRef(null);
  if (!refreshCoordinatorRef.current) refreshCoordinatorRef.current = createRefreshCoordinator();
  const liveRefreshRequestRef = useRef(() => false);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => { tradeLedgerRef.current = tradeLedger; }, [tradeLedger]);
  useEffect(() => { exchangeRateRef.current = exchangeRate; }, [exchangeRate]);
  useEffect(() => { jpyKrwRateRef.current = jpyKrwRate; }, [jpyKrwRate]);
  useEffect(() => { currencyRatesRef.current = currencyRates; }, [currencyRates]);

  useEffect(() => {
    if (!isCloudPortfolioLoaded) return undefined;
    let cancelled = false;

    const fetchLiveData = async ({ forceNetwork = false, reason = 'automatic' } = {}) => {
      const runId = refreshCoordinatorRef.current.begin();
      if (runId === null) {
        if (reason === 'manual') addLog('이미 최신 데이터를 확인하고 있습니다.', 'info');
        return false;
      }
      const isLatestRun = () => !cancelled && refreshCoordinatorRef.current.isCurrent(runId);

      setIsFetching(true);
      const currentAssets = assetsRef.current;
      const shouldShowSyncLogs = currentAssets.length > 0;
      setSyncProgress({ label: '환율과 데이터 소스 연결 중', completed: 0, total: currentAssets.length });
      if (shouldShowSyncLogs) addLog("데이터 연동을 시작합니다...", "info");

      try {
        if (currentAssets.length === 0) {
          if (reason === 'manual') addLog('동기화할 보유 자산이 없습니다.', 'error');
          return false;
        }
        let currentRate = exchangeRateRef.current;
        let currentJpyRate = jpyKrwRateRef.current;
        const nextCurrencyRates = { ...currencyRatesRef.current, KRW: 1 };
        const getCurrencyRate = async (currency = 'KRW') => {
          const code = String(currency || 'KRW').toUpperCase();
          if (code === 'KRW') return 1;
          if (nextCurrencyRates[code]) return nextCurrencyRates[code];

          const rate = await fetchKrwRate(code);
          if (rate) nextCurrencyRates[code] = rate;
          return nextCurrencyRates[code] || 0;
        };
        
        // [1] 환율/코인 연동
        const [fetchedRate, fetchedJpyRate, bitcoinPrices] = await Promise.all([
          fetchUsdKrwRate(),
          fetchKrwRate('JPY'),
          fetchBitcoinPrices(),
        ]);

        if (fetchedRate) {
          currentRate = fetchedRate;
          if (shouldShowSyncLogs) addLog(`실시간 환율 확인: 1$ = ${currentRate.toLocaleString(undefined, {maximumFractionDigits:2})}원`, "info");
        } else {
          if (shouldShowSyncLogs) addLog("환율 서버 응답 지연", "error");
        }
        if (currentRate > 0) setExchangeRate(currentRate);
        if (currentRate > 0) nextCurrencyRates.USD = currentRate;

        if (fetchedJpyRate) currentJpyRate = fetchedJpyRate;
        if (currentJpyRate > 0) setJpyKrwRate(currentJpyRate);
        if (currentJpyRate > 0) nextCurrencyRates.JPY = currentJpyRate;

        const currentTradeLedger = tradeLedgerRef.current;
        const dividendTasks = [];
        let successCount = 0;
        let failCount = 0;
        let dividendSuccessCount = 0;
        let dividendFailureCount = 0;
        const tradingViewAssets = currentAssets.map((asset) => (
          isDomesticQuoteAsset(asset) ? { ...asset, ticker: '' } : asset
        ));
        setSyncProgress({ label: '종목 시세 조회 중', completed: 0, total: currentAssets.length });
        const tradingViewQuotes = await fetchTradingViewQuotes(tradingViewAssets);

        const updatedAssets = await Promise.all(currentAssets.map(async (asset, assetIndex) => {
          let newCurrentPrice = asset.currentPrice;
          let newOriginalCurrentPrice = asset.originalCurrentPrice || asset.originalAveragePrice;
          let nextAssetCurrency = asset.currency;
          let quoteSource = asset.quoteSource || '';
          let quoteSession = asset.quoteSession || '';
          let quoteUpdatedAt = asset.quoteUpdatedAt || '';
          let quoteSyncState = asset.quoteSyncState || 'idle';
          let quoteSyncMessage = asset.quoteSyncMessage || '';
          
          if (asset.category === '현금') {
            newCurrentPrice = 1; newOriginalCurrentPrice = 1;
            quoteSource = 'cash';
            quoteUpdatedAt = new Date().toISOString();
            quoteSyncState = 'success';
            quoteSyncMessage = '';
            successCount++;
          } else if (asset.category === '가상화폐') {
            if (asset.currency === 'KRW' && bitcoinPrices.krw) {
              newCurrentPrice = bitcoinPrices.krw;
              quoteSource = 'coingecko';
              quoteUpdatedAt = new Date().toISOString();
              quoteSyncState = 'success';
              quoteSyncMessage = '';
              successCount++;
            } else if (asset.currency === 'USD' && bitcoinPrices.usd) {
              newCurrentPrice = bitcoinPrices.usd;
              quoteSource = 'coingecko';
              quoteUpdatedAt = new Date().toISOString();
              quoteSyncState = 'success';
              quoteSyncMessage = '';
              successCount++;
            } else {
              quoteSyncState = 'error';
              quoteSyncMessage = '시세 제공처에서 최신 가격을 받지 못했습니다.';
              failCount++;
            }
          } else if (asset.ticker) {
            
            // 현재가 연동
            const stockQuote = tradingViewQuotes[assetIndex] || await fetchStockQuote(asset);
            const fetchedPrice = stockQuote?.price ?? null;
            
            if (fetchedPrice !== null) {
              const quoteCurrency = stockQuote?.currency || asset.currency || 'KRW';
              const quoteRate = await getCurrencyRate(quoteCurrency);
              newOriginalCurrentPrice = fetchedPrice;
              nextAssetCurrency = quoteCurrency;
              quoteSource = stockQuote?.source || 'market';
              quoteSession = stockQuote?.session || '';
              quoteUpdatedAt = stockQuote?.asOf || '';
              if (quoteRate > 0) {
                newCurrentPrice = Math.round(newOriginalCurrentPrice * quoteRate);
                quoteSyncState = 'success';
                const normalizedSession = String(stockQuote?.session || '').toUpperCase();
                const marketSessionLabel = normalizedSession.includes('POST_MARKET')
                  ? '시간외 시세'
                  : normalizedSession.includes('PRE_MARKET')
                    ? '장전 시세'
                    : '';
                const delayLabel = stockQuote?.delaySeconds
                  ? `${Math.round(stockQuote.delaySeconds / 60)}분 지연`
                  : '';
                quoteSyncMessage = [marketSessionLabel, delayLabel].filter(Boolean).join(' · ');
                successCount++;
              } else {
                quoteSyncState = 'error';
                quoteSyncMessage = `${quoteCurrency} 실시간 환율을 받지 못해 원화 환산을 갱신하지 않았습니다.`;
                failCount++;
              }
            } else if (Number(asset.originalCurrentPrice) > 0 || Number(asset.currentPrice) > 0) {
              const cachedCurrency = asset.currency || asset.originalCurrency || 'KRW';
              const cachedRate = await getCurrencyRate(cachedCurrency);
              nextAssetCurrency = cachedCurrency;
              newOriginalCurrentPrice = Number(asset.originalCurrentPrice) > 0
                ? Number(asset.originalCurrentPrice)
                : cachedRate > 0
                  ? Number(asset.currentPrice) / cachedRate
                  : 0;
              newCurrentPrice = Number(asset.currentPrice) > 0
                ? Number(asset.currentPrice)
                : Math.round(newOriginalCurrentPrice * cachedRate);
              quoteSyncState = 'cached';
              quoteSyncMessage = '최신 시세를 받지 못해 직전 가격을 표시합니다.';
              failCount++;
            } else {
              quoteSyncState = 'error';
              quoteSyncMessage = '시세를 가져오지 못했습니다. 종목 코드를 확인해 주세요.';
              failCount++;
              addLog(`[${asset.name}] 주가 연동 실패 (티커 재확인)`, "error");
            }

            // 배당 갱신 실행 
            if (!isCommodityCategory(asset.category)) {
              const dividendStartDate = getDividendStartDate(asset, currentTradeLedger);
              dividendTasks.push(
                fetchDividends({
                  ...asset,
                  ticker: asset.ticker.toUpperCase().trim(),
                  securityType: asset.securityType || stockQuote?.securityType || '',
                  forceRefresh: forceNetwork,
                }).then((result) => {
                  if (!result || result.status === 'error') return {
                    asset,
                    error: true,
                    hasDividends: false,
                    sourceDividendCount: 0,
                    rows: [],
                    errorMessage: '공개 배당 데이터 소스에 연결하지 못했습니다.',
                  };

                  const dividends = result.dividends || {};
                  const sourceDividendCount = Object.keys(dividends).length;
                  const rows = buildAutoDividendRows({
                    asset,
                    ledger: currentTradeLedger,
                    dividends,
                    dividendStartDate,
                  });

                  return {
                    asset,
                    error: false,
                    hasDividends: sourceDividendCount > 0,
                    sourceDividendCount,
                    rows,
                    source: result.source,
                    checkedAt: result.fetchedAt,
                  };
                }).catch((error) => ({
                  asset,
                  error: true,
                  hasDividends: false,
                  sourceDividendCount: 0,
                  rows: [],
                  errorMessage: error?.message || '배당 데이터 갱신 중 오류가 발생했습니다.',
                }))
              );
            }
          }
          return {
            ...asset,
            currency: nextAssetCurrency,
            originalCurrency: nextAssetCurrency,
            currentPrice: newCurrentPrice,
            originalCurrentPrice: newOriginalCurrentPrice,
            quoteSource,
            quoteSession,
            quoteUpdatedAt,
            quoteSyncState,
            quoteSyncMessage,
          };
        }));

        if (!isLatestRun()) return false;

        setSyncProgress({
          label: '종목 시세 확인 완료',
          completed: currentAssets.length,
          total: currentAssets.length,
        });

        setCurrencyRates(prev => {
          const changed = Object.entries(nextCurrencyRates).some(([currency, rate]) => prev[currency] !== rate);
          return changed ? nextCurrencyRates : prev;
        });
        setAssets(prevAssets => mergeLiveAssetUpdates(prevAssets, updatedAssets));

        if (dividendTasks.length > 0) {
          setSyncProgress({ label: '배당 원본 조회 중', completed: 0, total: dividendTasks.length });
          if (shouldShowSyncLogs) addLog(`배당 데이터 ${dividendTasks.length}개 종목 확인 중...`, 'info');
          const dividendResults = await Promise.all(dividendTasks);
          if (!isLatestRun()) return false;

          setSyncProgress({
            label: '배당 계산 완료',
            completed: dividendTasks.length,
            total: dividendTasks.length,
          });

          const successfulResults = dividendResults.filter((result) => !result.error);
          const refreshedAssetNames = successfulResults.map((result) => result.asset.name).filter(Boolean);
          const nextAutoDividends = successfulResults
            .flatMap((result) => result.rows)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

          const nextRegistry = dividendResults.map((result) => (
            result.error
              ? {
                assetId: result.asset.id,
                name: result.asset.name,
                ticker: result.asset.ticker,
                category: result.asset.category,
                currency: result.asset.currency,
                syncState: 'error',
                errorMessage: result.errorMessage,
                lastErrorAt: new Date().toISOString(),
              }
              : {
                assetId: result.asset.id,
                name: result.asset.name,
                ticker: result.asset.ticker,
                category: result.asset.category,
                currency: result.asset.currency,
                hasDividends: result.hasDividends,
                sourceDividendCount: result.sourceDividendCount,
                earnedDividendCount: result.rows.length,
                source: result.source,
                syncState: result.hasDividends ? 'success' : 'empty',
                checkedAt: result.checkedAt || new Date().toISOString(),
              }
          ));

          dividendSuccessCount = successfulResults.length;
          dividendFailureCount = dividendResults.length - successfulResults.length;
          if (dividendFailureCount > 0) {
            addLog(`일부 배당 데이터 갱신 실패 (${dividendFailureCount}건). 기존 기록을 유지합니다.`, 'error');
          }

          setDividendAssetRegistry(prevRegistry => (
            mergeDividendAssetRegistry(prevRegistry, nextRegistry, currentAssets)
          ));

          setAutoDividends(prevDividends => (
            successfulResults.length > 0
              ? mergeDividendResultsByAsset(prevDividends, nextAutoDividends, currentAssets, refreshedAssetNames)
              : prevDividends.filter(dividend => currentAssets.some(asset => asset.name === dividend.name))
          ));

        } else {
          setAutoDividends(prevDividends => (
            prevDividends.filter(dividend => currentAssets.some(asset => asset.name === dividend.name))
          ));
        }

        if (isLatestRun()) {
          setLastUpdated(new Date().toLocaleTimeString());
          const finalLabel = `시세 ${successCount}개 · 실패 ${failCount}개 · 배당 ${dividendSuccessCount}개${dividendFailureCount > 0 ? ` · 실패 ${dividendFailureCount}개` : ''}`;
          setSyncProgress({
            label: finalLabel,
            completed: currentAssets.length,
            total: currentAssets.length,
          });
          if (reason === 'manual') {
            addLog(
              `전체 조회 완료: ${finalLabel}`,
              failCount > 0 || dividendFailureCount > 0 ? 'error' : 'success',
            );
          }
        }

        return true;

      } catch (e) { 
        console.error("Update error:", e); 
        if (isLatestRun()) {
          setSyncProgress({ label: '네트워크 오류로 조회 실패', completed: 0, total: assetsRef.current.length });
          if (assetsRef.current.length > 0) addLog("네트워크 오류로 갱신 실패", "error");
        }
        return false;
      }
      finally {
        if (refreshCoordinatorRef.current.finish(runId)) {
          setIsFetching(false);
        }
      }
    };
    
    liveRefreshRequestRef.current = fetchLiveData;
    fetchLiveData({ forceNetwork: false, reason: 'initial' });
    let interval;
    if (isLiveMode) interval = setInterval(() => fetchLiveData({ reason: 'automatic' }), AUTO_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (liveRefreshRequestRef.current === fetchLiveData) {
        liveRefreshRequestRef.current = () => false;
      }
      if (interval) clearInterval(interval);
    };
  }, [isLiveMode, isCloudPortfolioLoaded]);

  const handleManualRefresh = () => {
    setRefreshTrigger((value) => value + 1);
    liveRefreshRequestRef.current({ forceNetwork: true, reason: 'manual' });
  };

  const handleExportBackup = () => {
    const backup = createPortfolioBackup(compactPortfolioSnapshot(portfolioSnapshot));
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    addLog('포트폴리오 전체 백업 파일을 만들었습니다.', 'success');
  };

  const handleImportBackup = async (file) => {
    if (!file) return;
    try {
      const backup = parsePortfolioBackup(await file.text());
      const restored = compactPortfolioSnapshot(backup.data);
      const confirmed = window.confirm(
        `백업의 자산 ${restored.assets.length}개와 거래 ${restored.tradeLedger.length}건으로 현재 데이터를 복원할까요?`,
      );
      if (!confirmed) return;

      explicitRestorePendingRef.current = true;
      setAssets(restored.assets);
      setTrades(restored.trades);
      setMemos(restored.memos);
      setTradeLedger(restored.tradeLedger);
      setAutoDividends(restored.autoDividends);
      setConfirmedDividends(restored.confirmedDividends);
      setDividendAssetRegistry(restored.dividendAssetRegistry);
      setPortfolioName(restored.portfolioName);
      setTargetPortfolio(restored.targetPortfolio);
      addLog(
        `백업 복원 완료: 자산 ${restored.assets.length}개 · 거래 ${restored.tradeLedger.length}건`,
        'success',
      );
    } catch (error) {
      addLog(error?.message || '백업 파일을 복원하지 못했습니다.', 'error');
    }
  };

  const calculatedDividends = useMemo(() => (
    autoDividends.filter(isVerifiableDividendRecord)
  ), [autoDividends]);
  const verifiedConfirmedDividends = useMemo(() => (
    confirmedDividends.filter(isVerifiableDividendRecord)
  ), [confirmedDividends]);
  const reportedDividends = useMemo(() => (
    selectReportedDividendRecords(calculatedDividends, verifiedConfirmedDividends)
  ), [verifiedConfirmedDividends, calculatedDividends]);

  const {
    enhancedAssets,
    totalConvertedKRW,
    currentChartData,
    subChartData,
    currentCategoryKRW,
    currentCategoryUSD,
    currentCategoryTotalConverted,
    currentCategoryProfitKRW,
    currentCategoryProfitUSD,
    krwNetProfit,
    usdNetProfit,
    realizedProfitByCurrency,
    totalConvertedNetProfit,
    stockPerformanceSummary,
    dividendSummary,
    filteredHistory,
  } = usePortfolioMetrics({
    assets,
    trades,
    tradeLedger,
    autoDividends: reportedDividends,
    dividendAssetRegistry,
    exchangeRate,
    jpyKrwRate,
    currencyRates,
    selectedCategory,
    selectedDividendAsset,
    dividendFilter,
  });

  const isDomesticStockChart = selectedCategory?.includes('국내') && selectedCategory?.includes('주식');
  const isOverseasStockChart = selectedCategory?.includes('해외') && selectedCategory?.includes('주식');
  const profitTone = currentCategoryProfitKRW >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const profitBgTone = currentCategoryProfitKRW >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100';
  const visibleDetailAssets = useMemo(() => (
    [...(selectedCategory ? subChartData : enhancedAssets)]
      .map((asset) => ({
        ...asset,
        displayBuyDate: asset.category === '현금' ? '' : getDividendStartDate(asset, tradeLedger),
      }))
      .sort((a, b) => {
        const categoryDelta = getAssetCategoryOrder(a.category) - getAssetCategoryOrder(b.category);
        if (categoryDelta !== 0) return categoryDelta;
        return b.currentKRW - a.currentKRW;
      })
  ), [enhancedAssets, selectedCategory, subChartData, tradeLedger]);
  const currentChartGradient = useMemo(() => {
    if (currentChartData.length === 0) return 'conic-gradient(#e2e8f0 0% 100%)';

    const hasMultipleSlices = currentChartData.length > 1;
    return `conic-gradient(${currentChartData.flatMap((item) => {
      const start = Math.max(0, item.startPercent);
      const end = Math.min(100, item.startPercent + item.percent);
      const gap = hasMultipleSlices ? Math.min(0.07, item.percent * 0.08) : 0;
      const colorEnd = Math.max(start, end - gap);
      const colorSlice = `${item.color} ${start.toFixed(3)}% ${colorEnd.toFixed(3)}%`;
      if (gap <= 0.02 || colorEnd >= end) return [colorSlice];
      return [colorSlice, `rgba(255,255,255,0.58) ${colorEnd.toFixed(3)}% ${end.toFixed(3)}%`];
    }).join(', ')})`;
  }, [currentChartData]);
  const handleChartRingClick = (event) => {
    if (selectedCategory || currentChartData.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = event.clientX - centerX;
    const deltaY = event.clientY - centerY;
    const percent = (((Math.atan2(deltaY, deltaX) * 180) / Math.PI + 90 + 360) % 360) / 3.6;
    const clickedItem = currentChartData.find((item) => (
      percent >= item.startPercent && percent <= item.startPercent + item.percent
    ));

    if (clickedItem) setSelectedCategory(clickedItem.name);
  };
  const dashboardSummary = useMemo(() => {
    const purchaseKRW = enhancedAssets.reduce((sum, asset) => sum + asset.purchaseKRW, 0);
    const evaluationProfitKRW = enhancedAssets.reduce((sum, asset) => sum + asset.profitKRW, 0);
    const evaluationProfitByCurrency = enhancedAssets.reduce((summary, asset) => {
      const currency = asset.currency || 'KRW';
      summary[currency] = (summary[currency] || 0) + (Number(asset.profitNative) || 0);
      return summary;
    }, {});
    const dividendKRW = reportedDividends.reduce((sum, dividend) => (
      sum + (Number(dividend.amount) || 0) * getCachedKrwRate(dividend.currency, currencyRates, exchangeRate, jpyKrwRate)
    ), 0);
    const dividendByCurrency = reportedDividends.reduce((summary, dividend) => {
      const currency = dividend.currency || 'KRW';
      summary[currency] = (summary[currency] || 0) + (Number(dividend.amount) || 0);
      return summary;
    }, {});
    const dividendCountByCurrency = reportedDividends.reduce((summary, dividend) => {
      const currency = dividend.currency || 'KRW';
      summary[currency] = (summary[currency] || 0) + 1;
      return summary;
    }, {});
    const totalReturnPercent = purchaseKRW > 0 ? (evaluationProfitKRW / purchaseKRW) * 100 : 0;

    return {
      purchaseKRW,
      evaluationProfitKRW,
      evaluationProfitByCurrency,
      totalReturnPercent,
      dividendKRW,
      dividendByCurrency,
      dividendCountByCurrency,
    };
  }, [enhancedAssets, reportedDividends, exchangeRate, jpyKrwRate, currencyRates]);
  const evaluationProfitCurrencyParts = useMemo(() => (
    Object.entries(dashboardSummary.evaluationProfitByCurrency || {})
      .filter(([, amount]) => Math.abs(Number(amount) || 0) > 0.000001)
      .sort(([leftCurrency], [rightCurrency]) => {
        const order = { KRW: 0, USD: 1, JPY: 2 };
        return (order[leftCurrency] ?? 9) - (order[rightCurrency] ?? 9);
      })
      .map(([currency, amount]) => `${amount > 0 ? '+' : ''}${formatMoney(amount, currency)}`)
  ), [dashboardSummary.evaluationProfitByCurrency]);
  const realizedProfitCurrencyParts = useMemo(() => (
    Object.entries(realizedProfitByCurrency || {})
      .filter(([, amount]) => Math.abs(Number(amount) || 0) > 0.000001)
      .sort(([leftCurrency], [rightCurrency]) => {
        const order = { KRW: 0, USD: 1, JPY: 2 };
        return (order[leftCurrency] ?? 9) - (order[rightCurrency] ?? 9);
      })
      .map(([currency, amount]) => `${amount > 0 ? '+' : ''}${formatMoney(amount, currency)}`)
  ), [realizedProfitByCurrency]);
  const dividendCurrencyParts = useMemo(() => (
    [...new Set(['KRW', 'USD', ...Object.keys(dashboardSummary.dividendByCurrency || {})])]
      .sort((leftCurrency, rightCurrency) => {
        const order = { KRW: 0, USD: 1, JPY: 2 };
        return (order[leftCurrency] ?? 9) - (order[rightCurrency] ?? 9);
      })
      .map((currency) => formatMoney(dashboardSummary.dividendByCurrency?.[currency] || 0, currency))
  ), [dashboardSummary.dividendByCurrency]);
  const filteredPerformanceSummary = useMemo(() => {
    const keyword = performanceSearchTerm.trim().toLowerCase();
    if (!keyword) return stockPerformanceSummary;

    return stockPerformanceSummary.filter((summary) => (
      summary.name.toLowerCase().includes(keyword)
      || summary.ticker?.toLowerCase().includes(keyword)
      || summary.category?.toLowerCase().includes(keyword)
    ));
  }, [stockPerformanceSummary, performanceSearchTerm]);
  const dividendCalendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);
  const dividendCalendarEvents = useMemo(() => {
    const monthPrefix = calendarMonth;

    return dividendSummary
      .flatMap((summary) => {
        const history = Array.isArray(summary.history) ? summary.history : [];
        return history.map((dividend) => {
          const paymentDate = dividend.actualPaymentDate || dividend.paymentDate || '';
          const recordedMonthDate = /^\d{4}-\d{2}$/.test(dividend.period || '')
            ? `${dividend.period}-01`
            : '';
          const dateKey = paymentDate || recordedMonthDate || dividend.exDate || dividend.date || '';
          if (!dateKey.startsWith(monthPrefix)) return null;

          const quantity = Number(dividend.quantity) || 0;
          const grossAmount = Number(dividend.grossAmount) || null;
          const netAmount = Number(dividend.amount) || 0;
          if (netAmount <= 0) return null;

          return {
            id: `${dividend.id || summary.name}-${dateKey}`,
            date: dateKey,
            dateLabel: dividend.confirmationSource
              ? '직접 기록 월'
              : paymentDate
                ? '공시 지급일'
                : '배당락일',
            name: summary.name,
            ticker: dividend.ticker || summary.ticker || summary.name,
            currency: dividend.currency || summary.currency || 'KRW',
            grossAmount,
            netAmount,
            quantity,
          };
        });
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }, [calendarMonth, dividendSummary]);
  const dividendCalendarEventsByDate = useMemo(() => (
    dividendCalendarEvents.reduce((acc, event) => {
      if (!acc[event.date]) acc[event.date] = [];
      acc[event.date].push(event);
      return acc;
    }, {})
  ), [dividendCalendarEvents]);
  const selectedCalendarEvent = useMemo(() => (
    dividendCalendarEvents.find(event => event.id === selectedCalendarEventId) || dividendCalendarEvents[0] || null
  ), [dividendCalendarEvents, selectedCalendarEventId]);
  useEffect(() => {
    if (!selectedCalendarEventId) return;
    if (!dividendCalendarEvents.some(event => event.id === selectedCalendarEventId)) {
      setSelectedCalendarEventId('');
    }
  }, [dividendCalendarEvents, selectedCalendarEventId]);
  const targetBudgetKRW = parseNumber(targetPortfolio.budget) || totalConvertedKRW;
  const targetCategoryTotalPercent = targetPortfolio.categories.reduce((sum, category) => sum + (Number(category.percent) || 0), 0);
  const targetPortfolioGuide = useMemo(() => {
    const rate = Number(exchangeRate) || Number(currencyRates.USD) || 0;
    const yenRate = Number(jpyKrwRate) || Number(currencyRates.JPY) || 0;
    const toKrwPrice = (nativePrice, currency) => {
      return nativePrice * getCachedKrwRate(currency, currencyRates, rate, yenRate);
    };
    const toNativePrice = (krwPrice, currency) => {
      const krwRate = getCachedKrwRate(currency, currencyRates, rate, yenRate);
      return krwRate > 0 ? krwPrice / krwRate : 0;
    };

    return targetPortfolio.categories.map((categoryTarget) => {
      const categoryAssets = enhancedAssets.filter((asset) => asset.category === categoryTarget.id);
      const currentValue = categoryAssets.reduce((sum, asset) => sum + asset.currentKRW, 0);
      const targetValue = targetBudgetKRW * ((Number(categoryTarget.percent) || 0) / 100);
      const groups = getTargetGroups(targetPortfolio, categoryTarget.id);
      const groupTotalPercent = groups.reduce((sum, group) => sum + (Number(group.percent) || 0), 0);

      return {
        ...categoryTarget,
        currentValue,
        targetValue,
        gapValue: targetValue - currentValue,
        currentPercent: targetBudgetKRW > 0 ? (currentValue / targetBudgetKRW) * 100 : 0,
        groupTotalPercent,
        groups: groups.map((group) => {
          const groupTargetValue = targetValue * ((Number(group.percent) || 0) / 100);
          const items = group.items || [];
          const itemTotalPercent = items.reduce((sum, item) => sum + (Number(item.percent) || 0), 0);
          const enrichedItems = items.map((item) => {
            const itemCurrency = getTargetItemCurrency(categoryTarget.id, item.ticker, item.currency);
            const matchedAsset = categoryAssets.find((asset) => (
              asset.name === item.name || (item.ticker && asset.ticker?.toUpperCase() === item.ticker.toUpperCase())
            ));
            const currentItemValue = matchedAsset?.currentKRW || 0;
            const itemTargetValue = itemTotalPercent > 0
              ? groupTargetValue * ((Number(item.percent) || 0) / itemTotalPercent)
              : 0;
            const gapValue = itemTargetValue - currentItemValue;
            const currentPriceKRW = matchedAsset
              ? toKrwPrice((matchedAsset.originalCurrentPrice || matchedAsset.currentPrice), matchedAsset.currency)
              : parseNumber(item.price);
            const currentPriceNative = matchedAsset
              ? (matchedAsset.originalCurrentPrice || matchedAsset.currentPrice)
              : (parseNumber(item.nativePrice) || toNativePrice(currentPriceKRW, itemCurrency));

            return {
              ...item,
              currency: itemCurrency,
              currentValue: currentItemValue,
              targetValue: itemTargetValue,
              gapValue,
              currentPriceKRW,
              currentPriceNative,
              quantityToBuy: gapValue > 0 && currentPriceKRW > 0 ? gapValue / currentPriceKRW : 0,
              quantityToSell: gapValue < 0 && currentPriceKRW > 0 ? Math.abs(gapValue) / currentPriceKRW : 0,
              adjustmentSide: gapValue > 0 ? 'buy' : gapValue < 0 ? 'sell' : 'hold',
              adjustmentQuantity: currentPriceKRW > 0 ? Math.abs(gapValue) / currentPriceKRW : 0,
              matchedQuantity: matchedAsset?.quantity || 0,
            };
          });

          return {
            ...group,
            targetValue: groupTargetValue,
            currentValue: enrichedItems.reduce((sum, item) => sum + item.currentValue, 0),
            itemTotalPercent,
            items: enrichedItems,
          };
        }),
      };
    });
  }, [targetPortfolio, enhancedAssets, targetBudgetKRW, exchangeRate, jpyKrwRate, currencyRates]);
  const targetCurrentChartData = useMemo(() => {
    let cumulativePercent = 0;
    const grouped = Object.values(enhancedAssets.reduce((acc, asset) => {
      if (!acc[asset.category]) {
        acc[asset.category] = {
          id: `current-${asset.category}`,
          name: asset.category,
          value: 0,
        };
      }
      acc[asset.category].value += asset.currentKRW;
      return acc;
    }, {})).sort((a, b) => b.value - a.value);

    return grouped.map((category) => {
      const percent = totalConvertedKRW > 0 ? (category.value / totalConvertedKRW) * 100 : 0;
      const startPercent = cumulativePercent;
      cumulativePercent += percent;
      return {
        id: category.id,
        name: category.name,
        value: category.value,
        percent,
        startPercent,
        color: getCategoryColor(category.name),
      };
    });
  }, [enhancedAssets, totalConvertedKRW]);
  const targetGoalChartData = useMemo(() => {
    let cumulativePercent = 0;
    return targetPortfolioGuide.map((category) => {
      const percent = Number(category.percent) || 0;
      const startPercent = cumulativePercent;
      cumulativePercent += percent;
      return {
        id: `goal-${category.id}`,
        name: category.id,
        value: category.targetValue,
        percent,
        startPercent,
        color: getCategoryColor(category.id),
      };
    });
  }, [targetPortfolioGuide]);
  const selectedTargetGuide = useMemo(() => (
    targetPortfolioGuide.find(category => category.id === selectedTargetCategory) || null
  ), [targetPortfolioGuide, selectedTargetCategory]);
  const selectedTargetGroupGuide = useMemo(() => {
    if (!selectedTargetGuide || !selectedTargetGroup) return null;
    return selectedTargetGuide.groups.find(group => group.id === selectedTargetGroup) || null;
  }, [selectedTargetGuide, selectedTargetGroup]);
  const targetDrilldownChartData = useMemo(() => {
    if (!selectedTargetGuide) return targetGoalChartData;

    let cumulativePercent = 0;
    if (selectedTargetGroupGuide) {
      const items = selectedTargetGroupGuide.items.length > 0
        ? selectedTargetGroupGuide.items
        : [{ id: `${selectedTargetGroupGuide.id}-empty`, name: '종목 없음', targetValue: selectedTargetGroupGuide.targetValue, percent: 100 }];
      const itemTotalValue = items.reduce((sum, item) => sum + (Number(item.targetValue) || 0), 0);

      return items.map((item, index) => {
        const percent = itemTotalValue > 0 ? ((Number(item.targetValue) || 0) / itemTotalValue) * 100 : 0;
        const startPercent = cumulativePercent;
        cumulativePercent += percent;

        return {
          id: `target-item-${item.id}`,
          name: item.name || item.ticker || '이름 없음',
          value: item.targetValue,
          percent,
          startPercent,
          color: getCategoryDetailColor(selectedTargetGuide.id, index),
        };
      });
    }

    const groups = selectedTargetGuide.groups.length > 0
      ? selectedTargetGuide.groups
      : [{ id: `${selectedTargetGuide.id}-empty`, name: '미분류', targetValue: selectedTargetGuide.targetValue, percent: 100, items: [] }];

    return groups.map((group, index) => {
      const percent = selectedTargetGuide.targetValue > 0 ? (group.targetValue / selectedTargetGuide.targetValue) * 100 : 0;
      const startPercent = cumulativePercent;
      cumulativePercent += percent;

      return {
        id: `target-drill-${group.id}`,
        name: group.name || '미분류',
        groupId: group.id,
        value: group.targetValue,
        percent,
        startPercent,
        color: getCategoryDetailColor(selectedTargetGuide.id, index),
      };
    });
  }, [selectedTargetGuide, selectedTargetGroupGuide, targetGoalChartData]);

  useEffect(() => {
    if (!selectedTargetCategory) return;
    if (!targetPortfolio.categories.some(category => category.id === selectedTargetCategory)) {
      setSelectedTargetCategory(null);
      setSelectedTargetGroup(null);
    }
  }, [selectedTargetCategory, targetPortfolio.categories]);

  useEffect(() => {
    if (!selectedTargetGroup || !selectedTargetGuide) return;
    if (!selectedTargetGuide.groups.some(group => group.id === selectedTargetGroup)) {
      setSelectedTargetGroup(null);
    }
  }, [selectedTargetGroup, selectedTargetGuide]);

  useEffect(() => {
    if (!targetTickerSnapshotKey) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      const currentTargetPortfolio = targetPortfolioRef.current;
      const rate = Number(exchangeRate) || Number(currencyRates.USD) || await fetchKrwRate('USD') || 0;
      const currentJpyKrwRate = Number(jpyKrwRate) || Number(currencyRates.JPY) || await fetchKrwRate('JPY') || 0;
      const nextCurrencyRates = { ...currencyRatesRef.current, KRW: 1 };
      if (rate > 0) nextCurrencyRates.USD = rate;
      if (currentJpyKrwRate > 0) nextCurrencyRates.JPY = currentJpyKrwRate;
      const getCurrencyRate = async (currency = 'KRW') => {
        const code = String(currency || 'KRW').toUpperCase();
        if (code === 'KRW') return 1;
        if (nextCurrencyRates[code]) return nextCurrencyRates[code];

        const fetchedRate = await fetchKrwRate(code);
        if (fetchedRate) nextCurrencyRates[code] = fetchedRate;
        return nextCurrencyRates[code] || 0;
      };
      const syncTargets = [];
      const bitcoinPricesPromise = fetchBitcoinPrices();
      const toKrwPrice = async (nativePrice, currency) => nativePrice * await getCurrencyRate(currency);

      currentTargetPortfolio.categories.forEach((category) => {
        getTargetGroups(currentTargetPortfolio, category.id).forEach((group) => {
          (group.items || []).forEach((item) => {
            const ticker = item.ticker?.trim().toUpperCase();
            if (!ticker) return;
            const currency = getTargetItemCurrency(category.id, ticker, item.currency);
            syncTargets.push({
              categoryId: category.id,
              groupId: group.id,
              itemId: item.id,
              ticker,
              name: item.name,
              currency,
              currentPriceKRW: parseNumber(item.price),
              currentPriceNative: parseNumber(item.nativePrice),
            });
          });
        });
      });

      if (syncTargets.length === 0) {
        setTargetPriceSyncStatus('');
        return;
      }

      setTargetPriceSyncStatus('목표 종목 현재가 연동 중...');
      const updates = [];
      let failCount = 0;

      for (const target of syncTargets) {
        if (cancelled) return;

        const matchedAsset = enhancedAssets.find(asset => (
          asset.category === target.categoryId
          && (
            asset.ticker?.toUpperCase() === target.ticker
            || (target.name && asset.name === target.name)
          )
        ));

        if (matchedAsset) {
          const nativePrice = Number(matchedAsset.originalCurrentPrice || matchedAsset.currentPrice) || 0;
          const priceKRW = await toKrwPrice(nativePrice, matchedAsset.currency);
          updates.push({ ...target, currency: matchedAsset.currency, priceKRW, nativePrice, source: 'holding' });
          continue;
        }

        let fetchedPrice = null;
        let fetchedCurrency = target.currency;
        if (target.categoryId === '가상화폐' && ['BTC', 'BITCOIN'].includes(target.ticker)) {
          const bitcoinPrices = await bitcoinPricesPromise;
          fetchedPrice = target.currency === 'USD' ? bitcoinPrices.usd : bitcoinPrices.krw;
          fetchedCurrency = target.currency || 'KRW';
        } else {
          const stockQuote = await fetchStockQuote({
            ticker: target.ticker,
            category: target.categoryId,
            currency: target.currency,
          });
          fetchedPrice = stockQuote?.price ?? null;
          fetchedCurrency = stockQuote?.currency || target.currency || 'KRW';
        }

        if (fetchedPrice !== null) {
          updates.push({
            ...target,
            currency: fetchedCurrency,
            nativePrice: fetchedPrice,
            priceKRW: await toKrwPrice(fetchedPrice, fetchedCurrency),
            source: 'market',
          });
        } else if (target.currentPriceKRW > 0) {
          const cachedRate = await getCurrencyRate(target.currency);
          updates.push({
            ...target,
            nativePrice: target.currentPriceNative || (cachedRate > 0 ? target.currentPriceKRW / cachedRate : 0),
            priceKRW: target.currentPriceKRW,
            source: 'cached',
          });
        } else {
          failCount += 1;
        }
      }

      if (cancelled) return;

      if (updates.length > 0) {
        setCurrencyRates(prev => {
          const changed = Object.entries(nextCurrencyRates).some(([currency, rate]) => prev[currency] !== rate);
          return changed ? nextCurrencyRates : prev;
        });
        setTargetPortfolio(prev => ({
          ...prev,
          groups: {
            ...prev.groups,
            ...Object.fromEntries(prev.categories.map(category => [
              category.id,
              getTargetGroups(prev, category.id).map(group => ({
              ...group,
              items: (group.items || []).map(item => {
                const update = updates.find(candidate => (
                  candidate.categoryId === category.id
                  && candidate.groupId === group.id
                  && candidate.itemId === item.id
                  && candidate.ticker === item.ticker?.trim().toUpperCase()
                ));

                if (!update) return item;
                return {
                  ...item,
                  currency: update.currency,
                  price: String(Math.round(update.priceKRW)),
                  nativePrice: String(update.nativePrice),
                  priceSource: update.source,
                  priceUpdatedAt: new Date().toISOString(),
                };
              }),
            })),
            ])),
          },
        }));
      }

      setTargetPriceSyncStatus(
        updates.length > 0
          ? `현재가 ${updates.length.toLocaleString()}개 최신화 완료${failCount > 0 ? ` / 실패 ${failCount.toLocaleString()}개` : ''}`
          : '현재가를 가져오지 못했습니다. 티커를 확인해주세요.'
      );
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetTickerSnapshotKey, enhancedAssets, exchangeRate, jpyKrwRate, currencyRates, refreshTrigger]);

  const tradeRecords = useMemo(() => {
    const canonicalRows = buildCanonicalTradeRows({ tradeLedger, trades });
    return canonicalRows.map((entry) => ({
      ...entry,
      sourceType: tradeLedger.length > 0 ? 'ledger' : 'trade',
    }));
  }, [tradeLedger, trades]);
  const tradeStockOptions = useMemo(() => (
    [...new Set(tradeRecords.map((trade) => trade.name).filter(Boolean))].sort()
  ), [tradeRecords]);
  const enrichedMemos = useMemo(() => memos.map((memo) => {
    const matchingSellTrade = findMatchingSellTrade(memo, trades);
    if (!matchingSellTrade) return memo;

    return {
      ...memo,
      side: 'sell',
      action: '매도',
      ticker: memo.ticker || matchingSellTrade.ticker,
      category: memo.category || matchingSellTrade.category,
      currency: memo.currency || matchingSellTrade.currency,
      quantity: parseNumber(memo.quantity) || matchingSellTrade.quantity,
      price: parseNumber(memo.price) || matchingSellTrade.sellPrice,
      date: memo.date || matchingSellTrade.sellDate,
      pnl: getRecordPnl(memo) || getRecordPnl(matchingSellTrade),
      matchedTradeId: matchingSellTrade.id,
    };
  }), [memos, trades]);
  const memoStockOptions = useMemo(() => (
    [...new Set([
      ...tradeLedger.map((entry) => entry.name),
      ...enrichedMemos.map((memo) => memo.name),
    ].filter(Boolean))].sort()
  ), [tradeLedger, enrichedMemos]);
  const visibleTrades = useMemo(() => {
    const filtered = tradeStockFilter === 'all'
      ? tradeRecords
      : tradeRecords.filter((trade) => trade.name === tradeStockFilter);
    return sortTradeRecords(filtered, tradeSortMode);
  }, [tradeRecords, tradeStockFilter, tradeSortMode]);
  const displayedTrades = useMemo(() => (
    visibleTrades.slice(0, tradeVisibleCount)
  ), [visibleTrades, tradeVisibleCount]);
  const hasMoreTrades = visibleTrades.length > displayedTrades.length;

  useEffect(() => {
    setTradeVisibleCount(TRADE_PAGE_SIZE);
  }, [tradeStockFilter, tradeSortMode]);

  const memoLedgerRecords = useMemo(() => {
    const matchedMemoIds = new Set();
    const ledgerRecords = tradeLedger.map((entry) => {
      const matchedMemo = findMatchingMemoForLedger(entry, enrichedMemos);
      if (matchedMemo) matchedMemoIds.add(matchedMemo.id);

      return {
        ...entry,
        id: `ledger-${entry.id}`,
        ledgerId: entry.id,
        memoId: matchedMemo?.id,
        memo: matchedMemo?.memo || '',
        sourceType: 'ledger',
      };
    });
    const memoOnlyRecords = enrichedMemos
      .filter((memo) => !matchedMemoIds.has(memo.id))
      .map((memo) => ({
        ...memo,
        id: `memo-${memo.id}`,
        memoId: memo.id,
        sourceType: 'memo',
      }));

    return [...ledgerRecords, ...memoOnlyRecords];
  }, [tradeLedger, enrichedMemos]);
  const visibleMemos = useMemo(() => {
    const filtered = memoStockFilter === 'all'
      ? memoLedgerRecords
      : memoLedgerRecords.filter((memo) => memo.name === memoStockFilter);
    return sortTradeRecords(filtered, memoSortMode);
  }, [memoLedgerRecords, memoStockFilter, memoSortMode]);
  const tradeSummary = useMemo(() => {
    return buildTradeSummary(visibleTrades, exchangeRate, jpyKrwRate, currencyRates);
  }, [visibleTrades, exchangeRate, jpyKrwRate, currencyRates]);
  const memoSummary = useMemo(() => buildTradeSummary(visibleMemos, exchangeRate, jpyKrwRate, currencyRates), [visibleMemos, exchangeRate, jpyKrwRate, currencyRates]);

  const removeAsset = (id, e) => {
    if (e) e.stopPropagation();
    const assetToRemove = assets.find(asset => asset.id === id);
    setAssets(prevAssets => prevAssets.filter(a => a.id !== id));
    if (assetToRemove) {
      setTrades(prevTrades => prevTrades.filter(trade => !isRecordForAsset(trade, assetToRemove)));
      setMemos(prevMemos => prevMemos.filter(memo => !isRecordForAsset(memo, assetToRemove)));
      setTradeLedger(prevLedger => prevLedger.filter(entry => !isRecordForAsset(entry, assetToRemove)));
    }
    addLog("자산이 삭제되었습니다.", "success");
  };

  const removeTrade = (record, e) => {
    if (e) e.stopPropagation();
    if (record.sourceType === 'ledger') {
      const nextLedger = tradeLedger.filter(entry => entry.id !== record.id);
      setTradeLedger(nextLedger);
      setAssets(prevAssets => {
        const reconciledAssets = reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), nextLedger);
        return reconciledAssets.filter((asset) => {
          if (!isRecordForAsset(record, asset)) return true;
          return nextLedger.some(entry => isRecordForAsset(entry, asset) && getTradeSide(entry) === 'buy');
        });
      });
      setTrades(prevTrades => prevTrades.filter((trade) => {
        if (record.sourceId?.startsWith('trade-')) {
          const tradeId = record.sourceId.replace('trade-', '');
          if (String(trade.id) === tradeId) return false;
        }

        const isSameSellRecord =
          record.side === 'sell'
          && trade.name === record.name
          && trade.sellDate === record.date
          && numbersMatch(trade.quantity, record.quantity)
          && numbersMatch(trade.sellPrice, record.price);

        return !isSameSellRecord;
      }));
    } else {
      setTrades(prevTrades => prevTrades.filter(t => t.id !== record.id));
    }
    addLog("매매 기록이 삭제되었습니다.", "success");
  };

  const removeMemo = (id, e) => {
    if (e) e.stopPropagation();
    if (String(id).startsWith('ledger-')) {
      const ledgerId = String(id).replace('ledger-', '');
      const entry = tradeLedger.find((record) => String(record.id) === ledgerId);
      const matchedMemo = entry ? findMatchingMemoForLedger(entry, memos) : null;
      if (matchedMemo) {
        setMemos(prevMemos => prevMemos.filter(memo => memo.id !== matchedMemo.id));
        addLog("메모가 삭제되었습니다.", "success");
      }
      return;
    }
    setMemos(prevMemos => prevMemos.filter(memo => memo.id !== id && `memo-${memo.id}` !== id));
    addLog("메모가 삭제되었습니다.", "success");
  };

  const updateMemoText = (id, memoText) => {
    if (String(id).startsWith('ledger-')) {
      const ledgerId = String(id).replace('ledger-', '');
      const entry = tradeLedger.find((record) => String(record.id) === ledgerId);
      if (!entry) return;

      const matchedMemo = findMatchingMemoForLedger(entry, memos);
      if (matchedMemo) {
        setMemos(prevMemos => prevMemos.map((memo) => (
          memo.id === matchedMemo.id
            ? { ...memo, memo: memoText.trim(), updatedAt: new Date().toISOString() }
            : memo
        )));
      } else {
        setMemos(prevMemos => [{
          id: Date.now() + Math.random(),
          assetId: entry.assetId ?? null,
          name: entry.name,
          ticker: entry.ticker,
          category: entry.category,
          currency: entry.currency,
          side: entry.side,
          action: entry.action || (entry.side === 'sell' ? '매도' : '매수'),
          quantity: entry.quantity,
          price: entry.price,
          date: entry.date,
          pnl: entry.pnl || 0,
          memo: memoText.trim(),
          createdAt: new Date().toISOString(),
          ledgerId: entry.id,
        }, ...prevMemos]);
      }
      addLog('메모가 수정되었습니다.', 'success');
      return;
    }

    setMemos(prevMemos => prevMemos.map((memo) => (
      memo.id === id || `memo-${memo.id}` === id
        ? { ...memo, memo: memoText.trim(), updatedAt: new Date().toISOString() }
        : memo
    )));
    addLog('메모가 수정되었습니다.', 'success');
  };

  const addLedgerEntry = ({
    asset,
    side,
    quantity,
    price,
    date,
    pnl = 0,
    pnlKRW = 0,
    sourceId,
  }) => {
    const entry = buildLedgerEntry({
      sourceId,
      asset,
      side,
      quantity,
      price,
      date,
      pnl,
      pnlKRW,
    });
    setTradeLedger(prevLedger => [entry, ...prevLedger]);
  };

  const updateTargetCategoryPercent = (categoryId, percent) => {
    setTargetPortfolio(prev => ({
      ...prev,
      categories: prev.categories.map(category => (
        category.id === categoryId ? { ...category, percent: sanitizeNumericInput(percent) } : category
      )),
    }));
  };

  const addTargetCategory = () => {
    if (!targetCategoryDraft) return;
    setTargetPortfolio(prev => {
      if (prev.categories.some(category => category.id === targetCategoryDraft)) return prev;
      return {
        ...prev,
        categories: [...prev.categories, { id: targetCategoryDraft, percent: 0 }],
        items: { ...prev.items, [targetCategoryDraft]: [] },
        groups: { ...prev.groups, [targetCategoryDraft]: [] },
      };
    });
  };

  const removeTargetCategory = (categoryId) => {
    if (selectedTargetCategory === categoryId) {
      setSelectedTargetCategory(null);
      setSelectedTargetGroup(null);
    }
    setTargetPortfolio(prev => {
      const nextItems = { ...prev.items };
      const nextGroups = { ...prev.groups };
      delete nextItems[categoryId];
      delete nextGroups[categoryId];
      return {
        ...prev,
        categories: prev.categories.filter(category => category.id !== categoryId),
        items: nextItems,
        groups: nextGroups,
      };
    });
  };

  const addTargetGroup = (categoryId) => {
    setTargetPortfolio(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [categoryId]: [
          ...getTargetGroups(prev, categoryId),
          { id: `${Date.now()}-${Math.random()}`, name: '새 폴더', percent: 0, items: [] },
        ],
      },
    }));
  };

  const updateTargetGroup = (categoryId, groupId, patch) => {
    setTargetPortfolio(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).map(group => (
          group.id === groupId ? { ...group, ...patch } : group
        )),
      },
    }));
  };

  const removeTargetGroup = (categoryId, groupId) => {
    if (selectedTargetCategory === categoryId && selectedTargetGroup === groupId) {
      setSelectedTargetGroup(null);
    }
    setTargetPortfolio(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).filter(group => group.id !== groupId),
      },
    }));
  };

  const addTargetItem = (categoryId, groupId) => {
    setTargetPortfolio(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).map(group => (
          group.id === groupId
            ? {
              ...group,
              items: [
                ...(group.items || []),
                { id: `${Date.now()}-${Math.random()}`, name: '', ticker: '', percent: 0, price: '', nativePrice: '', currency: getTargetItemCurrency(categoryId) },
              ],
            }
            : group
        )),
      },
    }));
  };

  const updateTargetItem = (categoryId, groupId, itemId, patch) => {
    setTargetPortfolio(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).map(group => (
          group.id === groupId
            ? {
              ...group,
              items: (group.items || []).map(item => (
                item.id === itemId ? { ...item, ...patch } : item
              )),
            }
            : group
        )),
      },
    }));
  };

  const removeTargetItem = (categoryId, groupId, itemId) => {
    setTargetPortfolio(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).map(group => (
          group.id === groupId
            ? { ...group, items: (group.items || []).filter(item => item.id !== itemId) }
            : group
        )),
      },
    }));
  };

  const addTradeMemo = ({
    asset,
    action,
    quantity,
    price,
    date,
    memo,
    realizedPnl = 0,
    pnlKRW = 0,
  }) => {
    setMemos(prevMemos => [{
      id: Date.now() + Math.random(),
      assetId: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      category: asset.category,
      currency: asset.currency,
      side: action === '매도' ? 'sell' : 'buy',
      action,
      quantity,
      price,
      date,
      pnl: realizedPnl,
      pnlKRW,
      memo: memo?.trim() || '',
      createdAt: new Date().toISOString()
    }, ...prevMemos]);
  };

  const handleAddManualMemo = () => {
    if (!manualMemo.stockName || !manualMemo.date) {
      addLog('주식명과 날짜를 입력해주세요.', 'error');
      return;
    }

    const matchedAsset = assets.find((asset) => asset.name === manualMemo.stockName);
    const manualMemoAsset = {
      id: matchedAsset?.id ?? null,
      name: manualMemo.stockName,
      ticker: matchedAsset?.ticker || manualMemo.ticker,
      category: matchedAsset?.category || '',
      currency: matchedAsset?.currency || manualMemo.currency,
    };
    setMemos(prevMemos => [{
      id: Date.now() + Math.random(),
      assetId: manualMemoAsset.id,
      name: manualMemoAsset.name,
      ticker: manualMemoAsset.ticker,
      category: manualMemoAsset.category,
      currency: manualMemoAsset.currency,
      side: manualMemo.action === '매도' ? 'sell' : 'buy',
      action: manualMemo.action,
      quantity: parseNumber(manualMemo.quantity),
      price: parseNumber(manualMemo.price),
      date: manualMemo.date,
      pnl: parseNumber(manualMemo.realizedPnl),
      memo: manualMemo.memo.trim(),
      createdAt: new Date().toISOString()
    }, ...prevMemos]);
    addLedgerEntry({
      asset: manualMemoAsset,
      side: manualMemo.action === '매도' ? 'sell' : 'buy',
      quantity: parseNumber(manualMemo.quantity),
      price: parseNumber(manualMemo.price),
      date: manualMemo.date,
      pnl: parseNumber(manualMemo.realizedPnl),
    });

    setManualMemo({
      stockName: '',
      ticker: '',
      action: '매수',
      quantity: '',
      price: '',
      date: defaultBuyDate,
      realizedPnl: '',
      currency: 'KRW',
      memo: '',
    });
    addLog('메모가 추가되었습니다.', 'success');
  };

  const openAddBuyModal = (asset) => {
  setSelectedAssetToUpdate(asset);
  setAddBuyForm({
    quantity: '',
    averagePrice: '',
    buyDate: new Date().toISOString().split('T')[0],
    memo: ''
  });
  setIsUpdatingAsset(true);
};

  const openSellModal = (asset) => {
  setSelectedAssetToSell(asset);
  setSellForm({
    sellPrice: '',
    quantity: '',
    sellDate: new Date().toISOString().split('T')[0],
    memo: ''
  });
  setIsSellingAsset(true);
};

  const buildBuyLotDrafts = (asset) => {
  const buyRows = getAssetBuyLedgerRows(asset, tradeLedger);
  const sourceRows = buyRows.length > 0
    ? buyRows
    : [{
      id: '',
      sourceId: '',
      date: asset.buyDate || defaultBuyDate,
      quantity: asset.quantity,
      price: asset.originalAveragePrice || asset.averagePrice,
    }];

  return sourceRows.map((row, index) => ({
    draftId: String(row.id || row.sourceId || `fallback-${asset.id}-${index}`),
    ledgerId: row.id ? String(row.id) : '',
    sourceId: row.sourceId || '',
    date: getRecordDate(row) || asset.buyDate || defaultBuyDate,
      quantity: String(row.quantity ?? ''),
      price: String(row.price ?? ''),
  }));
};

  const openBuyLotsModal = (asset) => {
  setSelectedAssetToManageBuys(asset);
  setBuyLotDrafts(buildBuyLotDrafts(asset));
};

  const closeBuyLotsModal = () => {
  setSelectedAssetToManageBuys(null);
  setBuyLotDrafts([]);
};

  const updateBuyLotDraft = (draftId, field, value) => {
  setBuyLotDrafts(prevDrafts => prevDrafts.map(lot => (
    lot.draftId === draftId ? { ...lot, [field]: value } : lot
  )));
};

  const addBuyLotDraft = () => {
  setBuyLotDrafts(prevDrafts => [
    ...prevDrafts,
    {
      draftId: `new-${Date.now()}-${prevDrafts.length}`,
      ledgerId: '',
      sourceId: '',
      date: defaultBuyDate,
      quantity: '',
      price: '',
    },
  ]);
};

  const removeBuyLotDraft = (draftId) => {
  setBuyLotDrafts(prevDrafts => prevDrafts.filter(lot => lot.draftId !== draftId));
};

  const handleSaveBuyLots = () => {
  if (!selectedAssetToManageBuys) return;
  if (buyLotDrafts.length === 0) {
    addLog('매수 기록은 최소 1개 이상 필요합니다.', 'error');
    return;
  }

  const normalizedDrafts = buyLotDrafts.map((lot) => ({
    ...lot,
    quantity: parseNumber(lot.quantity),
    price: parseNumber(lot.price),
  }));

  const hasInvalidLot = normalizedDrafts.some(lot => (
    !lot.date
    || getDateTimestampSeconds(lot.date) <= 0
    || lot.quantity <= 0
    || lot.price <= 0
  ));

  if (hasInvalidLot) {
    addLog('매수일, 수량, 단가를 모두 올바르게 입력해주세요.', 'error');
    return;
  }

  const totalBuyQuantity = normalizedDrafts.reduce((sum, lot) => sum + lot.quantity, 0);
  const totalSellQuantity = getAssetLedgerRows(selectedAssetToManageBuys, tradeLedger)
    .filter((entry) => getTradeSide(entry) === 'sell')
    .reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);

  if (totalBuyQuantity + 0.000001 < totalSellQuantity) {
    addLog('총 매수 수량이 이미 기록된 매도 수량보다 적을 수 없습니다.', 'error');
    return;
  }

  const now = new Date().toISOString();
  const existingBuyRows = getAssetBuyLedgerRows(selectedAssetToManageBuys, tradeLedger);
  const existingBuyRowsById = new Map(existingBuyRows.map(row => [String(row.id), row]));
  const sortedDrafts = [...normalizedDrafts].sort((a, b) => (
    getDateTimestampSeconds(a.date) - getDateTimestampSeconds(b.date)
  ));
  const nextBuyRows = sortedDrafts.map((lot, index) => {
    const existingRow = lot.ledgerId ? existingBuyRowsById.get(String(lot.ledgerId)) : null;

    return {
      ...(existingRow || {}),
      id: existingRow?.id || `buy-${selectedAssetToManageBuys.id}-${Date.now()}-${index}`,
      sourceId: existingRow?.sourceId || lot.sourceId || undefined,
      assetId: selectedAssetToManageBuys.id,
      name: selectedAssetToManageBuys.name,
      ticker: selectedAssetToManageBuys.ticker || '',
      category: selectedAssetToManageBuys.category || '',
      currency: selectedAssetToManageBuys.currency || 'KRW',
      accountName: selectedAssetToManageBuys.accountName || '',
      accountType: selectedAssetToManageBuys.accountType || 'GENERAL',
      sourceCountry: selectedAssetToManageBuys.sourceCountry || '',
      securityType: selectedAssetToManageBuys.securityType || '',
      dividendTaxRate: Number(selectedAssetToManageBuys.dividendTaxRate) || 0,
      dividendTaxRateExplicit: selectedAssetToManageBuys.dividendTaxRateExplicit === true,
      dividendTaxBasisPerShare: Number(selectedAssetToManageBuys.dividendTaxBasisPerShare) || 0,
      adrFeePerShare: Number(selectedAssetToManageBuys.adrFeePerShare) || 0,
      adrFeePerShareExplicit: selectedAssetToManageBuys.adrFeePerShareExplicit === true,
      side: 'buy',
      action: '매수',
      quantity: lot.quantity,
      price: lot.price,
      date: lot.date,
      pnl: 0,
      createdAt: existingRow?.createdAt || now,
      updatedAt: now,
    };
  });

  const nextLedger = [
    ...tradeLedger.filter(entry => !(
      isSameAssetRecord(selectedAssetToManageBuys, entry)
      && getTradeSide(entry) === 'buy'
    )),
    ...nextBuyRows,
  ].sort((a, b) => new Date(getRecordDate(b)) - new Date(getRecordDate(a)));

  setTradeLedger(nextLedger);
  setAssets(prevAssets => reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), nextLedger));
  setMemos(prevMemos => {
    const matchedBuyMemos = existingBuyRows
      .map(row => findMatchingMemoForLedger(row, prevMemos))
      .filter(Boolean);
    const matchedMemoIds = new Set(matchedBuyMemos.map(memo => memo.id));
    const nextBuyMemos = nextBuyRows.map((row, index) => {
      const existingMemo = matchedBuyMemos[index];
      return {
        ...(existingMemo || {}),
        id: existingMemo?.id || Date.now() + Math.random() + index,
        assetId: selectedAssetToManageBuys.id,
        name: selectedAssetToManageBuys.name,
        ticker: selectedAssetToManageBuys.ticker || '',
        category: selectedAssetToManageBuys.category || '',
        currency: selectedAssetToManageBuys.currency || 'KRW',
        side: 'buy',
        action: '매수',
        quantity: row.quantity,
        price: row.price,
        date: row.date,
        pnl: 0,
        memo: existingMemo?.memo || '',
        createdAt: existingMemo?.createdAt || now,
        updatedAt: now,
      };
    });

    return [
      ...nextBuyMemos,
      ...prevMemos.filter(memo => !matchedMemoIds.has(memo.id)),
    ];
  });

  addLog(`'${selectedAssetToManageBuys.name}' 매수 기록을 저장했습니다.`, 'success');
  closeBuyLotsModal();
};

  const handleAddBuyToAsset = () => {
  if (!selectedAssetToUpdate) return;

  const addedQty = parseNumber(addBuyForm.quantity);
  const addedAvgNative = parseNumber(addBuyForm.averagePrice);
  const selectedAssetIdentity = getAssetIdentity(selectedAssetToUpdate);
  const updatedAt = new Date().toISOString();

  if (isNaN(addedQty) || addedQty <= 0) {
    addLog("추가 매수 수량을 올바르게 입력해주세요.", "error");
    return;
  }

  if (isNaN(addedAvgNative) || addedAvgNative <= 0) {
    addLog("추가 매수 단가를 올바르게 입력해주세요.", "error");
    return;
  }

  setAssets(prevAssets =>
    mergeUniqueAssets(prevAssets.map(asset => {
      if (asset.id !== selectedAssetToUpdate.id && getAssetIdentity(asset) !== selectedAssetIdentity) return asset;

      const oldQty = parseNumber(asset.quantity);
      const oldAvgNative = parseNumber(asset.originalAveragePrice || asset.averagePrice);

      const totalQty = oldQty + addedQty;
      const totalCostNative = oldQty * oldAvgNative + addedQty * addedAvgNative;
      const nextOriginalAveragePrice = totalQty > 0 ? totalCostNative / totalQty : 0;

      const currentFirstBuyDate = getDividendStartDate(asset, tradeLedger) || asset.buyDate;
      const currentFirstBuyTimestamp = getDateTimestampSeconds(currentFirstBuyDate);
      const addedBuyTimestamp = getDateTimestampSeconds(addBuyForm.buyDate);
      const nextBuyDate =
        addedBuyTimestamp > 0
        && (
          currentFirstBuyTimestamp <= 0
          || addedBuyTimestamp < currentFirstBuyTimestamp
        )
          ? addBuyForm.buyDate
          : currentFirstBuyDate;

      return {
        ...asset,
        quantity: totalQty,
        averagePrice: nextOriginalAveragePrice,
        originalAveragePrice: nextOriginalAveragePrice,
        buyDate: nextBuyDate,
        updatedAt,
      };
    }))
  );

  addTradeMemo({
    asset: selectedAssetToUpdate,
    action: '매수',
    quantity: addedQty,
    price: addedAvgNative,
    date: addBuyForm.buyDate,
    memo: addBuyForm.memo,
  });
  addLedgerEntry({
    asset: selectedAssetToUpdate,
    side: 'buy',
    quantity: addedQty,
    price: addedAvgNative,
    date: addBuyForm.buyDate,
  });

  addLog(`'${selectedAssetToUpdate.name}' 추가 매수 반영 완료`, "success");
  setIsUpdatingAsset(false);
  setSelectedAssetToUpdate(null);
  setAddBuyForm(initialAddBuyState);

};

  const handleSellAsset = () => {
  if (!selectedAssetToSell) return;

  const sellQty = parseNumber(sellForm.quantity);
  const sellPriceNative = parseNumber(sellForm.sellPrice);

  if (isNaN(sellQty) || sellQty <= 0) {
    addLog("매도 수량을 올바르게 입력해주세요.", "error");
    return;
  }

  if (isNaN(sellPriceNative) || sellPriceNative <= 0) {
    addLog("매도 단가를 올바르게 입력해주세요.", "error");
    return;
  }

  const currentQty = parseNumber(selectedAssetToSell.quantity);
  if (sellQty > currentQty) {
    addLog("보유 수량보다 많이 매도할 수 없습니다.", "error");
    return;
  }

  const avgBuyNative = parseNumber(selectedAssetToSell.originalAveragePrice || selectedAssetToSell.averagePrice);
  const previewSellId = `preview-sell-${Date.now()}`;
  const previewPosition = buildPositionFromTradeRows([
    ...getAssetLedgerRows(selectedAssetToSell, tradeLedger),
    {
      id: previewSellId,
      assetId: selectedAssetToSell.id,
      name: selectedAssetToSell.name,
      ticker: selectedAssetToSell.ticker,
      category: selectedAssetToSell.category,
      currency: selectedAssetToSell.currency,
      side: 'sell',
      quantity: sellQty,
      price: sellPriceNative,
      date: sellForm.sellDate,
    },
  ]);
  const previewSell = previewPosition.rows.find((row) => row.id === previewSellId);
  const pnlNative = previewSell?.pnl
    ?? ((sellPriceNative - avgBuyNative) * sellQty);
  const pnlKRW = previewSell?.pnlKRW || 0;
  const selectedAssetIdentity = getAssetIdentity(selectedAssetToSell);
  const updatedAt = new Date().toISOString();

  const trade = {
    id: Date.now(),
    name: selectedAssetToSell.name,
    ticker: selectedAssetToSell.ticker,
    category: selectedAssetToSell.category,
    currency: selectedAssetToSell.currency,
    buyDate: selectedAssetToSell.buyDate,
    sellDate: sellForm.sellDate,
    buyPrice: avgBuyNative,
    sellPrice: sellPriceNative,
    quantity: sellQty,
    pnl: pnlNative,
    pnlKRW,
  };

  const remainingQty = currentQty - sellQty;

  setTrades(prev => [trade, ...prev]);

  if (remainingQty === 0) {
    setAssets(prev => prev.filter(asset => (
      asset.id !== selectedAssetToSell.id && getAssetIdentity(asset) !== selectedAssetIdentity
    )));
  } else {
    setAssets(prev =>
      mergeUniqueAssets(prev.map(asset =>
        asset.id === selectedAssetToSell.id || getAssetIdentity(asset) === selectedAssetIdentity
          ? { ...asset, quantity: remainingQty, updatedAt }
          : asset
      ))
    );
  }

  addTradeMemo({
    asset: selectedAssetToSell,
    action: '매도',
    quantity: sellQty,
    price: sellPriceNative,
    date: sellForm.sellDate,
    memo: sellForm.memo,
    realizedPnl: pnlNative,
    pnlKRW,
  });
  addLedgerEntry({
    sourceId: `trade-${trade.id}`,
    asset: selectedAssetToSell,
    side: 'sell',
    quantity: sellQty,
    price: sellPriceNative,
    date: sellForm.sellDate,
    pnl: pnlNative,
    pnlKRW,
  });

  addLog(`'${selectedAssetToSell.name}' 매도 반영 완료`, "success");
  setIsSellingAsset(false);
  setSelectedAssetToSell(null);
  setSellForm(initialSellFormState);

};

  // 자산 추가 처리
  const handleAddAsset = () => {
    if (!newAsset.name || !newAsset.quantity) return;
    if (newAsset.category !== '현금' && !newAsset.averagePrice) return;
    
    const ticker = normalizeInputTicker(newAsset.ticker);
    const assetCurrency = getAssetInputCurrency(newAsset.category, ticker, newAsset.currency);
    const parsedQty = parseNumber(newAsset.quantity);
    const parsedAvgPrice = newAsset.category === '현금'
      ? 1
      : parseNumber(newAsset.averagePrice);
    let krwAveragePrice = parsedAvgPrice;
    if (assetCurrency === 'USD' || assetCurrency === 'JPY') krwAveragePrice = parsedAvgPrice;
    const dividendProfile = getAssetDividendProfile({
      ...newAsset,
      ticker,
      currency: assetCurrency,
    });
    const dividendTaxRateInput = parseNumber(newAsset.dividendTaxRate);
    const dividendTaxRate = dividendTaxRateInput > 1
      ? dividendTaxRateInput / 100
      : dividendTaxRateInput;
    const hasExplicitDividendTaxRate = String(newAsset.dividendTaxRate).trim() !== '';

    const asset = {
      id: Date.now(), 
      name: newAsset.name, 
      ticker,
      category: newAsset.category, 
      currency: assetCurrency,
      averagePrice: krwAveragePrice, 
      quantity: parsedQty, 
      currentPrice: krwAveragePrice, 
      originalCurrency: assetCurrency, 
      originalAveragePrice: parsedAvgPrice, 
      originalCurrentPrice: parsedAvgPrice, 
      buyDate: newAsset.buyDate,
      accountName: newAsset.accountName.trim(),
      accountType: newAsset.accountType || 'GENERAL',
      sourceCountry: newAsset.sourceCountry || dividendProfile.sourceCountry,
      securityType: newAsset.securityType || dividendProfile.securityType,
      dividendTaxRate: hasExplicitDividendTaxRate ? dividendTaxRate : dividendProfile.dividendTaxRate,
      dividendTaxRateExplicit: hasExplicitDividendTaxRate,
      dividendTaxBasisPerShare: parseNumber(newAsset.dividendTaxBasisPerShare),
      adrFeePerShare: parseNumber(newAsset.adrFeePerShare),
      adrFeePerShareExplicit: newAsset.adrFeePerShareExplicit === true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      color: getCategoryDetailColor(newAsset.category, assets.filter(asset => asset.category === newAsset.category).length)
    };

    setAssets(prevAssets => mergeUniqueAssets([...prevAssets, asset]));
    addTradeMemo({
      asset,
      action: '매수',
      quantity: parsedQty,
      price: parsedAvgPrice,
      date: newAsset.buyDate,
      memo: newAsset.memo,
  });
    addLedgerEntry({
      asset,
      side: 'buy',
      quantity: parsedQty,
      price: parsedAvgPrice,
      date: newAsset.buyDate,
  });
    setNewAsset(initialAssetState);
    setIsAdding(false);
    addLog(`'${asset.name}' 자산 추가됨. 다음 동기화 때 최신가가 반영됩니다.`, "info");
    
  };


  return (
    <div className="portfolio-app px-3 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-7">
      
      {/* 동기화 라이브 피드백 */}
      <SyncStatusToast
        isFetching={isFetching}
        syncLabel={syncProgress.label}
        syncStatus={syncStatus}
      />

      <div className="portfolio-shell space-y-5 md:space-y-6">
        
        {/* Header */}
        <DashboardHeader
          exchangeRate={exchangeRate}
          isFetching={isFetching}
          syncLabel={syncProgress.label}
          lastUpdated={lastUpdated}
          portfolioName={portfolioName}
          onAddAsset={() => {
            setIsAdding(true);
          }}
          onPortfolioNameChange={setPortfolioName}
          onRefresh={handleManualRefresh}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
          onTogglePrivacy={() => setPrivacyMode(value => !value)}
          privacyMode={privacyMode}
          userEmail={userEmail}
          onSignOut={signOutUser}
        />

        {/* 탭 */}
        <TabNav activeTab={activeTab} onChange={setActiveTab} />

        <main
          id={`panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="portfolio-content relative"
        >
          <div
            className={`transition-[filter,opacity] duration-200 ${privacyMode ? 'pointer-events-none select-none blur-md opacity-35' : ''}`}
            aria-hidden={privacyMode}
          >
        {activeTab === 'portfolio' && (
          <div className="space-y-5 animate-in fade-in duration-500">
            <section className="portfolio-metrics-grid grid grid-cols-2 gap-3">
              {[
                {
                  label: '총 평가금액',
                  value: formatMoney(totalConvertedKRW, 'KRW'),
                  icon: Wallet,
                  tone: 'text-slate-900',
                  accent: 'blue',
                  helper: `${enhancedAssets.length.toLocaleString()}개 자산`,
                },
                {
                  label: '총 수익률',
                  value: `${dashboardSummary.totalReturnPercent > 0 ? '+' : ''}${dashboardSummary.totalReturnPercent.toFixed(2)}%`,
                  icon: dashboardSummary.totalReturnPercent >= 0 ? TrendingUp : TrendingDown,
                  tone: dashboardSummary.totalReturnPercent >= 0 ? 'text-emerald-600' : 'text-rose-600',
                  accent: 'emerald',
                  helper: evaluationProfitCurrencyParts.length > 0
                    ? evaluationProfitCurrencyParts.join(' / ')
                    : formatMoney(0, 'KRW'),
                },
                {
                  label: '실현손익',
                  value: realizedProfitCurrencyParts.length > 0
                    ? realizedProfitCurrencyParts.join(' / ')
                    : formatMoney(0, 'KRW'),
                  icon: ArrowRightLeft,
                  tone: totalConvertedNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600',
                  accent: 'violet',
                  helper: `원화 환산 ${totalConvertedNetProfit > 0 ? '+' : ''}${formatMoney(totalConvertedNetProfit, 'KRW')}`,
                },
                {
                  label: '배당 수익',
                  value: dividendCurrencyParts.length > 0 ? dividendCurrencyParts.join(' / ') : formatMoney(0, 'KRW'),
                  icon: Receipt,
                  tone: dashboardSummary.dividendKRW >= 0 ? 'text-slate-900' : 'text-rose-600',
                  accent: 'amber',
                  helper: `${verifiedConfirmedDividends.length > 0 ? '직접 기록' : '자동 계산'} · 원화 ${dashboardSummary.dividendCountByCurrency.KRW || 0}건 · 달러 ${dashboardSummary.dividendCountByCurrency.USD || 0}건`,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={`metric-card metric-card--${item.accent}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-[10px] md:text-[11px] font-bold text-slate-400">{item.label}</p>
                      <div className="metric-card__icon">
                        <Icon size={15} />
                      </div>
                    </div>
                    <p className={`text-lg md:text-xl lg:text-[21px] font-black tracking-tight wrap-break-word ${item.tone}`}>{item.value}</p>
                    <p className="mt-1 text-[10px] md:text-xs font-semibold text-slate-400">{item.helper}</p>
                  </div>
                );
              })}
            </section>

            <div className="portfolio-overview-grid flex flex-col gap-4 lg:gap-5">
            {/* SVG 드릴다운 차트 */}
            <div className="surface-panel order-2 lg:order-2 p-5 lg:p-6 flex flex-col items-center h-full">
              <div className="w-full flex justify-between items-center mb-5 lg:mb-5">
                <h2 className="text-base lg:text-[15px] font-black text-slate-900 flex items-center gap-2"><PieIcon className="text-slate-500" size={18}/> {selectedCategory ? `${selectedCategory}` : '자산 비중'}</h2>
                {selectedCategory && (
                  <button onClick={() => setSelectedCategory(null)} className="text-[9px] md:text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-1 md:px-3 md:py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-200 uppercase tracking-widest"><ArrowLeft size={10} /> 메인으로</button>
                )}
              </div>
              {enhancedAssets.length === 0 ? (
                <div className="w-full min-h-[18rem] md:min-h-80 flex flex-col items-center justify-center text-center px-3">
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center mb-4 md:mb-5">
                    <Target size={24} className="md:w-7 md:h-7" />
                  </div>
                  <p className="text-base md:text-lg font-bold text-slate-900">첫 자산을 추가해보세요</p>
                  <p className="mt-2 text-xs md:text-sm font-medium text-slate-400 leading-relaxed max-w-xs">
                    종목을 등록하면 비중, 수익률, 배당 기록이 이 화면에 바로 쌓입니다.
                  </p>
                  <button
                    onClick={() => {
                      setIsAdding(true);
                    }}
                    className="mt-5 md:mt-6 inline-flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-sm hover:bg-slate-800 transition-colors"
                  >
                    <Plus size={16} /> 자산 추가
                  </button>
                </div>
              ) : (
		                <div className="relative w-64 h-64 lg:w-80 lg:h-80 xl:w-88 xl:h-88">
                  <div
                    className={`absolute inset-0 rounded-full transition-all duration-700 ${!selectedCategory ? 'cursor-pointer hover:opacity-90' : 'opacity-95'}`}
                    style={{ background: currentChartGradient }}
                    onClick={handleChartRingClick}
                    role={!selectedCategory ? 'button' : undefined}
                    tabIndex={!selectedCategory ? 0 : undefined}
                    aria-label={!selectedCategory ? '가장 큰 자산 분류 상세 보기' : undefined}
                    onKeyDown={(event) => {
                      if (selectedCategory || !['Enter', ' '].includes(event.key)) return;
                      event.preventDefault();
                      if (currentChartData[0]) setSelectedCategory(currentChartData[0].name);
                    }}
                  />
                  <div className="absolute inset-[12%] rounded-full bg-white shadow-inner shadow-slate-100/80" />
	                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-4 lg:p-6">
	                    <span className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mb-1">{selectedCategory ? `${selectedCategory}` : 'Total'}</span>
	                    <div className="flex flex-col items-center gap-0.5">
	                      {currentCategoryKRW > 0 && <span className="text-base md:text-lg lg:text-[clamp(1rem,1.35vw,1.35rem)] font-bold text-slate-900 tracking-tight whitespace-nowrap">{formatMoney(currentCategoryKRW, 'KRW')}</span>}
	                      {currentCategoryKRW > 0 && currentCategoryUSD > 0 && <span className="text-[9px] text-slate-300 font-bold">+</span>}
	                      {currentCategoryUSD > 0 && <span className="text-base md:text-lg lg:text-[clamp(1rem,1.35vw,1.35rem)] font-bold text-slate-900 tracking-tight whitespace-nowrap">{formatMoney(currentCategoryUSD, 'USD')}</span>}
	                    </div>
                    {isDomesticStockChart ? (
	                      <div className={`mt-2 md:mt-3 max-w-[82%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${profitBgTone}`}>
                        <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest">총 수익금액</span>
                        <span className={`text-[10px] md:text-[11px] font-bold ${profitTone}`}>
                          {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                        </span>
                      </div>
                    ) : isOverseasStockChart ? (
	                      <div className={`mt-2 md:mt-3 max-w-[82%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${currentCategoryProfitUSD >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                        <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest">총 수익금액</span>
                        <span className={`text-[10px] md:text-[11px] font-bold ${currentCategoryProfitUSD >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {currentCategoryProfitUSD > 0 ? '+' : ''}{formatMoney(currentCategoryProfitUSD, 'USD')}
                        </span>
                      </div>
                    ) : (
                      <>
	                        <div className="mt-2 md:mt-3 max-w-[86%] bg-slate-50 px-2 py-1 md:px-3 md:py-1.5 rounded-full border border-slate-100 flex items-center justify-center gap-1.5">
	                          <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">총 평가가치</span>
	                          <span className="text-[10px] md:text-[11px] lg:text-[12px] font-bold text-slate-700 whitespace-nowrap">{formatMoney(currentCategoryTotalConverted, 'KRW')}</span>
	                        </div>
	                        <div className={`mt-1.5 max-w-[86%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${profitBgTone}`}>
	                          <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">총 수익금액</span>
	                          <span className={`text-[10px] md:text-[11px] font-bold ${profitTone}`}>
                            {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                          </span>
                          {isOverseasStockChart && currentCategoryProfitUSD !== 0 && (
                            <span className={`text-[10px] md:text-[11px] font-bold ${profitTone}`}>
                              / {currentCategoryProfitUSD > 0 ? '+' : ''}{formatMoney(currentCategoryProfitUSD, 'USD')}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-6 lg:mt-6 w-full space-y-1.5">
                {currentChartData.map(data => (
                  <button key={data.id || data.name} onClick={() => !selectedCategory && setSelectedCategory(data.name)} className={`w-full flex items-center justify-between p-3 lg:px-3 lg:py-2.5 rounded-xl border transition-all ${!selectedCategory ? 'bg-slate-50 border-slate-100 hover:bg-white hover:border-slate-200' : 'bg-white border-slate-100'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shadow-inner" style={{ backgroundColor: data.color }}></div>
                      <span className="text-[11px] md:text-xs font-bold text-slate-700">{data.name}</span>
                    </div>
                    <span className="text-[10px] md:text-[11px] font-bold text-slate-400">{data.percent.toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            </div>

            {/* List 섹션 */}
            <div className="order-1 lg:order-1 space-y-6 min-w-0">
              <div className="surface-panel overflow-hidden">
                <div className="section-header p-5 lg:px-5 lg:py-4 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-base lg:text-[15px] font-black text-slate-900">{selectedCategory ? `${selectedCategory} 상세 목록` : '보유 자산 상세'}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table holdings-card-list w-full text-left">
                    <thead className="hidden">
                      <tr className="text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-[0.16em] border-b border-slate-100 bg-slate-50/50">
                        <th className="px-4 py-3 md:px-5 md:py-3.5 w-[30%]">종목/자산</th>
                        <th className="px-4 py-3 md:px-5 md:py-3.5 w-[38%]">상세 가치</th>
                        <th className="px-4 py-3 md:px-4 md:py-3.5 text-right w-[20%]">수익률</th>
                        <th className="px-4 py-3 md:px-3 md:py-3.5 text-center w-[12%]">관리</th>
                      </tr>
                    </thead>
                    <tbody className="block md:table-row-group divide-y divide-slate-50">
                      {visibleDetailAssets.map((asset) => (
                        <tr key={asset.id} className="block md:table-row px-4 py-5 md:p-0 hover:bg-slate-50/60 transition-all group">
                          <td className="block md:table-cell px-0 py-0 md:px-5 md:py-4 whitespace-nowrap align-middle">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-2xl md:rounded-xl flex items-center justify-center text-white font-black text-xl md:text-lg shadow-sm group-hover:scale-[1.02] transition-transform" style={{ backgroundColor: asset.color }}>
                                {asset.category === '현금' ? <Banknote size={20}/> : asset.name[0]}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-black text-slate-900 text-base md:text-[15px] leading-none truncate">{asset.name}</p>
                                <p className="text-xs md:text-[12px] text-slate-400 font-bold mt-2 md:mt-1.5 uppercase tracking-[0.14em] truncate">
                                  {asset.category === '현금' ? 'CASH' : asset.ticker} {asset.category !== '현금' && `• ${asset.quantity.toLocaleString()}${asset.category==='원자재'?'단위':'주'}`}
                                </p>
                                {asset.category !== '현금' && (
                                  <p className="text-[10px] md:text-[11px] text-slate-400 font-bold mt-1 truncate">
                                    최초 매수일 {asset.displayBuyDate || asset.buyDate || '-'}
                                  </p>
                                )}
                                {asset.category !== '현금' && (
                                  <p
                                    className={`mt-1 flex items-center gap-1.5 text-[9px] md:text-[10px] font-black ${getQuoteStatusMeta(asset).className}`}
                                    title={asset.quoteSyncMessage || '시장 시세 동기화 상태'}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${getQuoteStatusMeta(asset).dotClassName}`} />
                                    <span>{getQuoteStatusMeta(asset).label}</span>
                                    <span className="font-bold text-slate-400">
                                      {getQuoteSourceLabel(asset.quoteSource)}
                                      {formatQuoteTime(asset.quoteUpdatedAt) ? ` · ${formatQuoteTime(asset.quoteUpdatedAt)}` : ''}
                                    </span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="block md:table-cell px-0 py-4 md:px-5 md:py-4 align-middle">
                            <div className="grid grid-cols-2 gap-x-4 md:gap-x-5 gap-y-3 md:gap-y-1.5 bg-slate-50/80 md:bg-transparent px-4 py-3.5 md:p-0 rounded-xl md:rounded-none border border-slate-200/70 md:border-0 group-hover:border-slate-300 transition-colors w-full min-w-0">
                              <div className="flex flex-col">
                                <span className="text-[8px] md:text-[9px] text-slate-400 font-black uppercase tracking-widest">{asset.category === '현금' ? '보유 원금' : '총 매입'}</span>
                                <span className="font-black text-slate-700 text-xs md:text-[13px] mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(asset.purchaseNative, asset.currency)}</span>
                              </div>
                              <div className="flex flex-col text-right">
                                {asset.category !== '현금' && (
                                  <><span className="text-[8px] md:text-[9px] text-slate-400 font-black uppercase tracking-widest">평단가</span><span className="font-black text-slate-700 text-xs md:text-[13px] mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(asset.originalAveragePrice || asset.averagePrice, asset.originalCurrency || asset.currency)}</span></>
                                )}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[8px] md:text-[9px] text-slate-500 font-black uppercase tracking-widest">총 가치</span>
                                <span className="font-black text-slate-900 text-xs md:text-[13px] mt-1 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(asset.currentNative, asset.currency)}</span>
                              </div>
                              <div className="flex flex-col text-right">
                                {asset.category !== '현금' && (
                                  <><span className="text-[8px] md:text-[9px] text-slate-500 font-black uppercase tracking-widest">현재가</span><span className="font-black text-slate-900 text-xs md:text-[13px] mt-1 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(asset.originalCurrentPrice || asset.currentPrice, asset.originalCurrency || asset.currency)}</span></>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="block md:table-cell px-0 pb-4 md:px-4 md:py-4 text-left md:text-right whitespace-nowrap align-middle">
                            {asset.category === '현금' ? <span className="text-[10px] md:text-xs font-black text-slate-300">-</span> : (
                              <div className="flex flex-row md:flex-col items-stretch md:items-end gap-2">
                                <div className={`inline-flex items-center justify-center gap-1.5 flex-1 md:flex-none md:w-full px-2 md:px-2.5 py-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[13px] font-black ${asset.returnPercent >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                  {asset.returnPercent >= 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} {Math.abs(asset.returnPercent).toFixed(2)}%
                                </div>
                                <div className={`inline-flex items-center justify-center flex-1 md:flex-none md:w-full px-2 md:px-2.5 py-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[13px] font-black ${asset.profitNative >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                  {asset.profitNative > 0 ? '+' : ''}{formatMoney(asset.profitNative, asset.currency)}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="block md:table-cell px-0 py-0 md:px-3 md:py-4 text-right md:text-center whitespace-nowrap align-middle">
                          <div className="flex flex-wrap md:flex-col items-center justify-end md:justify-center gap-2 md:gap-1">
                            {asset.category !== '현금' && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openAddBuyModal(asset);
                                  }}
                                  className="inline-flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors px-2.5 py-2 rounded-xl text-[11px] font-black"
                                  title="추가 매수"
                                >
                                  <Plus size={16} className="md:w-4.5 md:h-4.5" />
                                  <span className="md:hidden">추가 매수</span>
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openSellModal(asset);
                                  }}
                                  className="inline-flex items-center justify-center gap-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors px-2.5 py-2 rounded-xl text-[11px] font-black"
                                  title="일부 매도"
                                >
                                  <Minus size={16} className="md:w-4.5 md:h-4.5" />
                                  <span className="md:hidden">일부 매도</span>
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openBuyLotsModal(asset);
                                  }}
                                  className="inline-flex items-center justify-center gap-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors px-2.5 py-2 rounded-xl text-[11px] font-black"
                                  title="매수 기록 관리"
                                >
                                  <CalendarDays size={16} className="md:w-4.5 md:h-4.5" />
                                  <span className="md:hidden">매수 기록</span>
                                </button>
                              </>
                            )}

                            <button
                              onClick={(e) => removeAsset(asset.id, e)}
                              className="inline-flex items-center justify-center gap-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors px-2.5 py-2 rounded-xl text-[11px] font-black"
                              title="자산 삭제"
                            >
                              <Trash2 size={16} className="md:w-4.5 md:h-4.5" />
                            </button>
                          </div>
                        </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {enhancedAssets.length === 0 && (
                    <div className="p-6 md:p-12 text-center">
                      <div className="mx-auto w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mb-4">
                        <Wallet size={24} />
                      </div>
                      <p className="text-slate-800 font-bold text-sm md:text-base">아직 등록된 자산이 없습니다.</p>
                      <p className="mt-2 text-slate-400 font-medium text-xs md:text-sm">주식, 가상화폐, 현금을 추가하면 상세 가치와 수익률이 표시됩니다.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {/* 수익 및 기록 탭 */}
        {activeTab === 'history' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            
            <h3 className="text-lg md:text-xl font-black text-slate-900 flex items-center gap-2"><ArrowRightLeft className="text-blue-600" size={20} /> 종목 매매(실현) 수익 요약</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="metric-card metric-card--emerald p-5 md:p-7 flex flex-col justify-center">
                <div className="metric-card__icon mb-3 md:mb-4"><Banknote size={18} /></div>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-1">원화 매매 순수익</p>
                <p className={`text-2xl md:text-3xl font-black tracking-tighter ${krwNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {krwNetProfit > 0 ? '+' : ''}{formatMoney(krwNetProfit, 'KRW')}
                </p>
              </div>
              <div className="metric-card metric-card--violet p-5 md:p-7 flex flex-col justify-center">
                <div className="metric-card__icon mb-3 md:mb-4"><DollarSign size={18} /></div>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-1">달러 매매 순수익</p>
                <p className={`text-2xl md:text-3xl font-black tracking-tighter ${usdNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {usdNetProfit > 0 ? '+' : ''}{formatMoney(usdNetProfit, 'USD')}
                </p>
              </div>
              <div className="relative overflow-hidden rounded-[1.2rem] bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 p-5 text-white shadow-[0_18px_45px_rgba(15,23,42,0.18)] md:p-7 flex flex-col justify-center">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet size={50}/></div>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-1">총 환산 매매 순수익</p>
                <p className={`text-3xl md:text-4xl font-black tracking-tighter ${totalConvertedNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalConvertedNetProfit > 0 ? '+' : ''}{formatMoney(totalConvertedNetProfit, 'KRW')}
                </p>
              </div>
            </div>

            <div className="surface-panel overflow-hidden">
              <div className="section-header p-5 md:p-7 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-base md:text-lg font-black text-slate-900">종목별 총 손익</h3>
                  <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-1">평가손익, 실현손익, 공시·원장으로 검증된 배당을 합산합니다.</p>
                </div>
                <div className="relative w-full md:w-72">
                  <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={performanceSearchTerm}
                    onChange={(e) => setPerformanceSearchTerm(e.target.value)}
                    placeholder="종목명 또는 티커 검색"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-700"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-left table-auto">
                  <thead className="bg-slate-50/50 text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em]">
                    <tr>
                      <th className="px-4 py-4 md:px-8 md:py-5">종목</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">누적 매수/매도</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">평가 손익</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">실현 손익</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">배당 합계</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">총 손익</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredPerformanceSummary.map((summary) => {
                      const totalTone = summary.totalKRW >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50';
                      return (
                        <tr key={summary.name} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-4 md:px-8 md:py-6 whitespace-nowrap">
                            <p className="text-sm md:text-base font-black text-slate-900">{summary.name}</p>
                            <p className="text-[9px] md:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
                              {summary.ticker || summary.category || '기록 종목'}
                              {summary.quantity > 0 && ` • 보유 ${summary.quantity.toLocaleString()}주`}
                            </p>
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-black text-slate-600 whitespace-nowrap">
                            <div>매수 {summary.totalBuyQuantity.toLocaleString()}주</div>
                            <div className="text-slate-400 mt-1">매도 {summary.totalSellQuantity.toLocaleString()}주</div>
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-black text-slate-600 whitespace-nowrap">
                            {summary.unrealizedKRW > 0 ? '+' : ''}{formatMoney(summary.unrealizedKRW, 'KRW')}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-black text-slate-600 whitespace-nowrap">
                            {summary.realizedKRW > 0 ? '+' : ''}{formatMoney(summary.realizedKRW, 'KRW')}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-black text-slate-600 whitespace-nowrap">
                            {summary.dividendKRW > 0 ? '+' : ''}{formatMoney(summary.dividendKRW, 'KRW')}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                            <div className="flex flex-col items-end gap-1">
                              {summary.currency === 'USD' && (
                                <>
                                  <span className={`inline-flex px-3 py-1.5 rounded-xl text-xs md:text-sm font-black ${totalTone}`}>
                                  {summary.totalNative > 0 ? '+' : ''}{formatMoney(summary.totalNative, 'USD')}
                                  </span>
                                  <span className="text-[10px] md:text-xs font-black text-slate-400">
                                    원화 환산 {summary.totalKRW > 0 ? '+' : ''}{formatMoney(summary.totalKRW, 'KRW')}
                                  </span>
                                </>
                              )}
                              {summary.currency !== 'USD' && (
                                <span className={`inline-flex px-3 py-1.5 rounded-xl text-xs md:text-sm font-black ${totalTone}`}>
                                  {summary.totalKRW > 0 ? '+' : ''}{formatMoney(summary.totalKRW, 'KRW')}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredPerformanceSummary.length === 0 && (
                  <p className="p-8 md:p-10 text-center text-slate-400 font-bold text-xs md:text-sm">검색 결과가 없습니다.</p>
                )}
              </div>
            </div>

            <div className="surface-panel p-5 md:p-7">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-3 md:gap-4">
                <h3 className="text-lg md:text-xl font-black flex items-center gap-2 md:gap-3">
                  <Receipt className="text-slate-500" size={20}/> 
                  {selectedDividendAsset ? `${selectedDividendAsset} 배당 상세 기록` : '종목별 누적 배당 요약'}
                </h3>
                
                {selectedDividendAsset ? (
                  <div className="flex items-center gap-2 md:gap-3">
                    <select 
                      value={dividendFilter} 
                      onChange={e => setDividendFilter(e.target.value)}
                      className="px-3 py-1.5 md:px-4 md:py-2 bg-slate-50 border border-slate-100 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold outline-none text-slate-600"
                    >
                      <option value="이번 달">이번 달</option>
                      <option value="올해">올해</option>
                      <option value="전체">전체 기간</option>
                    </select>
                    <button onClick={() => { setSelectedDividendAsset(null); setDividendFilter('전체'); }} className="text-[9px] md:text-[10px] font-black text-slate-600 bg-slate-100 px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:bg-slate-200 uppercase tracking-widest transition-all">
                      <ArrowLeft size={12} /> 전체 보기
                    </button>
                  </div>
                ) : (
                  <span className="text-[9px] md:text-[10px] bg-slate-100 text-slate-600 px-2 py-1 md:px-3 md:py-1.5 rounded-full font-black tracking-widest uppercase">
                    공시 주당 금액 × 배당락일 원장 수량
                  </span>
                )}
              </div>

              {!selectedDividendAsset ? (
                <div className="max-h-[620px] overflow-y-auto pr-1 md:pr-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {dividendSummary.length > 0 ? dividendSummary.map(summary => (
                    <div 
                      key={summary.name} 
                      onClick={() => setSelectedDividendAsset(summary.name)} 
                      className="surface-panel surface-panel--interactive cursor-pointer p-5 md:p-6 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-4 md:mb-6">
                        <div className="whitespace-nowrap overflow-hidden pr-3 md:pr-4">
                          <h4 className="font-black text-slate-800 text-base md:text-lg group-hover:text-slate-900 transition-colors truncate">{summary.name}</h4>
                          <p className="text-[9px] md:text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">상세 보기</p>
                        </div>
                        <div className="text-right whitespace-nowrap shrink-0">
                          <p className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest mb-0.5 md:mb-1">누적 배당 수익</p>
                          <p className="text-lg md:text-xl font-black text-slate-900">{formatMoney(summary.totalAmount, summary.currency)}</p>
                        </div>
                      </div>
                      
                      <div className={`inline-flex items-center px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[10px] md:text-[11px] font-black tracking-widest ${summary.status.includes('실패') ? 'bg-rose-50 text-rose-600' : summary.status.includes('확인') ? 'bg-emerald-50 text-emerald-600' : summary.status.includes('이번 달') ? 'bg-slate-100 text-slate-700' : 'bg-slate-200/50 text-slate-500'}`}>
                        {summary.status}
                      </div>
                    </div>
                  )) : (
                    <div className="col-span-full py-8 md:py-12 text-center text-slate-400 font-bold text-xs md:text-sm">
                      {isFetching ? '배당 데이터를 갱신 중입니다...' : '매수일 이후 배당 내역이 없거나 데이터를 불러올 수 없습니다.'}
                    </div>
                  )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 rounded-2xl p-1 md:p-2 border border-slate-100">
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-left table-auto">
                      <thead className="text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em] border-b border-slate-200/50">
                        <tr>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">기준 수량</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">주당 세후</th>
                          <th className="px-4 py-4 md:px-8 md:py-5">배당락일</th>
                          <th className="px-4 py-4 md:px-8 md:py-5">종목명</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">세전</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">세금</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">수수료</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">세후</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-center">상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/50">
                        {filteredHistory.length > 0 ? filteredHistory.map(div => (
                          <tr key={div.id} className="hover:bg-white transition-colors group">
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-black text-slate-500 whitespace-nowrap">
                              {Number(div.quantity || 0) > 0 ? `${Number(div.quantity).toLocaleString()}주` : '-'}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-black text-slate-500 whitespace-nowrap">
                              {Number(div.perShareNetAmount || 0) > 0 ? formatMoney(div.perShareNetAmount, div.currency) : '-'}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-xs md:text-sm font-bold text-slate-500 whitespace-nowrap">
                              {div.exDate || div.date}
                              {(div.actualPaymentDate || div.paymentDate) && (
                                <span className="block mt-1 text-[9px] text-slate-400">
                                  지급 {div.actualPaymentDate || div.paymentDate}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-sm md:text-base font-black text-slate-800 whitespace-nowrap">{div.name}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-black text-slate-500 whitespace-nowrap">
                              {Number(div.grossAmount || 0) > 0 ? formatMoney(div.grossAmount, div.currency) : '-'}
                              {div.calculationFormula && <span className="calculation-formula">{div.calculationFormula}</span>}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-black text-rose-500 whitespace-nowrap">
                              {div.confirmationSource
                                ? '-'
                                : Number(div.taxAmount || 0) > 0
                                  ? `-${formatMoney(div.taxAmount, div.currency)}`
                                  : formatMoney(0, div.currency)}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-black text-amber-600 whitespace-nowrap">
                              {div.confirmationSource
                                ? '-'
                                : Number(div.feeAmount || 0) > 0
                                  ? `-${formatMoney(div.feeAmount, div.currency)}`
                                  : formatMoney(0, div.currency)}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-sm md:text-base font-black text-slate-900 whitespace-nowrap">
                              {formatMoney(div.amount, div.currency)}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-center whitespace-nowrap">
                              <span
                                title={div.taxNote || ''}
                                className={`status-pill ${
                                  div.taxCalculationMode === 'tax-basis'
                                    ? 'status-pill--basis'
                                    : div.status === 'estimated'
                                      ? 'status-pill--estimated'
                                      : 'status-pill--confirmed'
                                }`}
                              >
                                {div.confirmationSource
                                  ? '직접 기록'
                                  : div.taxCalculationMode === 'tax-basis'
                                  ? '과표 확인'
                                  : div.status === 'estimated'
                                    ? '자동 계산'
                                    : '지급 완료'}
                              </span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="9" className="px-4 py-12 md:px-8 md:py-16 text-center">
                              <p className="text-slate-400 font-bold mb-2 text-xs md:text-sm">해당하는 배당 지급 내역이 없습니다.</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="surface-panel overflow-hidden">
              <div className="section-header p-5 md:p-7 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-base md:text-lg font-black text-slate-900">과거 매매 기록</h3>
              </div>
              <div className="p-5 md:p-6 border-b border-slate-50 bg-white space-y-4">
                <div className="flex flex-col md:flex-row gap-3">
                  <select
                    value={tradeStockFilter}
                    onChange={(e) => setTradeStockFilter(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-700"
                  >
                    <option value="all">전체 종목</option>
                    {tradeStockOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={tradeSortMode}
                    onChange={(e) => setTradeSortMode(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-700"
                  >
                    {TRADE_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className={`grid grid-cols-1 gap-3 ${tradeStockFilter !== 'all' ? 'md:grid-cols-3' : ''}`}>
                  {tradeStockFilter !== 'all' && (
                    <>
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총 매수 수량</p>
                        <p className="text-lg font-black text-slate-800">{tradeSummary.totalBuyQuantity.toLocaleString()}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총 매도 수량</p>
                        <p className="text-lg font-black text-slate-800">{tradeSummary.totalSellQuantity.toLocaleString()}</p>
                      </div>
                    </>
                  )}
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">실현 손익</p>
                    <p className={`text-lg font-black ${tradeSummary.totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tradeSummary.totalProfit > 0 ? '+' : ''}{formatMoney(tradeSummary.totalProfit, 'KRW')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-left table-auto">
                  <thead className="bg-slate-50/50 text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em]">
                    <tr>
                      <th className="px-4 py-4 md:px-8 md:py-5">종목</th>
                      <th className="px-4 py-4 md:px-8 md:py-5">매수/매도일</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">매수가/매도가</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">실현 손익</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-center">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {displayedTrades.map((trade) => {
                      const side = getTradeSide(trade);
                      const action = side === 'sell' ? '매도' : '매수';
                      const date = getRecordDate(trade);
                      const price = side === 'sell'
                        ? (trade.price || trade.sellPrice)
                        : (trade.price || trade.buyPrice);
                      const pnl = getRecordPnl(trade);

                      return (
                        <tr key={`${trade.sourceType}-${trade.id}`} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-4 md:px-8 md:py-6 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex px-2 py-1 rounded-lg text-[10px] font-black ${side === 'sell' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                                {action}
                              </span>
                              <div>
                                <p className="text-sm md:text-base font-black text-slate-800">{trade.name}</p>
                                {trade.ticker && (
                                  <p className="text-[9px] md:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">{trade.ticker}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-[10px] md:text-xs text-slate-500 font-bold whitespace-nowrap">
                            <span className="text-slate-400 mr-1 md:mr-2">{action}일:</span>{date || '-'}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-black text-slate-700 space-y-1 whitespace-nowrap">
                            <div>{formatMoney(price, trade.currency)}</div>
                            <div className="text-slate-400">{Number(trade.quantity || 0).toLocaleString()}주</div>
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                            {side === 'sell' ? (
                              <span className={`inline-flex font-black px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl text-[10px] md:text-xs ${pnl >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                {pnl > 0 ? '+' : ''}{formatMoney(pnl, trade.currency)}
                              </span>
                            ) : (
                              <span className="text-[10px] md:text-xs font-black text-slate-300">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-center whitespace-nowrap">
                            <button onClick={(e) => removeTrade(trade, e)} className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors p-1.5 md:p-2 rounded-xl" title="기록 삭제"><Trash2 size={16} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visibleTrades.length === 0 && <p className="p-8 md:p-10 text-center text-slate-400 font-bold text-xs md:text-sm">표시할 매매 기록이 없습니다.</p>}
              </div>
              {visibleTrades.length > 0 && (
                <div className="px-5 py-4 md:px-8 md:py-5 border-t border-slate-50 bg-slate-50/40 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="text-[10px] md:text-xs font-bold text-slate-400">
                    최근 {displayedTrades.length.toLocaleString()}개 표시 중 / 전체 {visibleTrades.length.toLocaleString()}개
                  </p>
                  <div className="flex gap-2">
                    {hasMoreTrades && (
                      <button
                        onClick={() => setTradeVisibleCount(count => count + TRADE_PAGE_SIZE)}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] md:text-xs font-black text-slate-700 hover:text-slate-900 hover:border-slate-300 transition-colors"
                      >
                        더보기
                      </button>
                    )}
                    {displayedTrades.length > TRADE_PAGE_SIZE && (
                      <button
                        onClick={() => setTradeVisibleCount(TRADE_PAGE_SIZE)}
                        className="px-4 py-2 bg-white border border-slate-100 rounded-xl text-[10px] md:text-xs font-black text-slate-400 hover:text-slate-700 transition-colors"
                      >
                        접기
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {activeTab === 'target' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="surface-panel overflow-hidden">
              <div className="section-header p-5 md:p-7 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-base md:text-lg font-black text-slate-900">목표 포트폴리오 설정</h3>
                  <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-1">분류별 목표 비중과 분류 안 종목별 목표 비중을 저장합니다.</p>
                </div>
                <div className="w-full md:w-80">
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                    기준 총 예산
                  </label>
                  <input
                    value={formatInputNumber(targetPortfolio.budget)}
                    onChange={(e) => setTargetPortfolio(prev => ({ ...prev, budget: sanitizeNumericInput(e.target.value) }))}
                    placeholder={`현재 총자산 ${formatMoney(totalConvertedKRW, 'KRW')}`}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-sm font-black text-slate-800"
                  />
                </div>
              </div>

              <div className="p-5 md:p-6 border-b border-slate-50 bg-white">
                <div className="flex flex-col md:flex-row gap-3 md:items-end">
                  <div className="flex-1">
                    <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                      분류 추가
                    </label>
                    <select
                      value={targetCategoryDraft}
                      onChange={(e) => setTargetCategoryDraft(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-700"
                    >
                      {['국내주식', '해외주식', '현금', '가상화폐', '원자재'].map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={addTargetCategory}
                    className="px-5 py-3 bg-slate-900 text-white rounded-xl font-black text-xs md:text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"
                  >
                    <Plus size={16} /> 분류 추가
                  </button>
                  <div className={`px-5 py-3 rounded-xl border text-xs md:text-sm font-black ${Math.abs(targetCategoryTotalPercent - 100) < 0.001 ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                    전체 목표 {targetCategoryTotalPercent.toFixed(1)}%
                  </div>
                  {targetPriceSyncStatus && (
                    <div className="px-5 py-3 rounded-xl border bg-slate-50 border-slate-200 text-slate-700 text-xs md:text-sm font-black">
                      {targetPriceSyncStatus}
                    </div>
                  )}
                  <div className="flex bg-slate-100 border border-slate-100 rounded-xl p-1">
                    {[
                      { id: 'table', label: '표' },
                      { id: 'chart', label: '파이그래프' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setTargetViewMode(mode.id)}
                        className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${targetViewMode === mode.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {targetViewMode === 'chart' && (
                <div className="p-5 md:p-7 border-b border-slate-50 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {[
                    { title: '현재 포트폴리오', data: targetCurrentChartData, center: formatMoney(totalConvertedKRW, 'KRW') },
                    {
                      title: selectedTargetGroupGuide
                        ? `${selectedTargetGroupGuide.name || '미분류'} 세부 종목`
                        : selectedTargetGuide
                          ? `${selectedTargetGuide.id} 목표 내부`
                          : '목표 포트폴리오',
                      data: selectedTargetGuide ? targetDrilldownChartData : targetGoalChartData,
                      center: selectedTargetGroupGuide
                        ? formatMoney(selectedTargetGroupGuide.targetValue, 'KRW')
                        : selectedTargetGuide
                          ? formatMoney(selectedTargetGuide.targetValue, 'KRW')
                          : formatMoney(targetBudgetKRW, 'KRW'),
                      drilldown: true,
                    },
                  ].map((chart) => (
                    <div key={chart.title} className="bg-slate-50 border border-slate-100 rounded-2xl p-5 md:p-6">
                      <div className="flex items-center justify-between gap-3 mb-5">
                        <h4 className="text-sm md:text-base font-black text-slate-900">{chart.title}</h4>
                        {chart.drilldown && selectedTargetGuide ? (
                          <button
                            onClick={() => {
                              if (selectedTargetGroupGuide) {
                                setSelectedTargetGroup(null);
                              } else {
                                setSelectedTargetCategory(null);
                              }
                            }}
                            className="text-[10px] font-black text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl flex items-center gap-1"
                          >
                            <ArrowLeft size={12} /> {selectedTargetGroupGuide ? '폴더 목록' : '전체 목표'}
                          </button>
                        ) : (
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{chart.center}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 items-center">
                        <div className="relative w-52 h-52 mx-auto">
                          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                            {chart.data.map((item) => (
                              <circle
                                key={item.id}
                                cx="18"
                                cy="18"
                                r="15.9"
                                fill="transparent"
                                stroke={item.color}
                                strokeWidth="3.8"
                                strokeDasharray={`${item.percent} ${100 - item.percent}`}
                                strokeDashoffset={-item.startPercent}
                                className={chart.drilldown && !selectedTargetGroupGuide ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
                                onClick={() => {
                                  if (chart.drilldown && !selectedTargetGuide) {
                                    setSelectedTargetCategory(item.name);
                                    setSelectedTargetGroup(null);
                                  }
                                  else if (chart.drilldown && selectedTargetGuide && !selectedTargetGroupGuide && item.groupId) setSelectedTargetGroup(item.groupId);
                                }}
                              />
                            ))}
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                              {selectedTargetGroupGuide && chart.drilldown ? selectedTargetGroupGuide.name : selectedTargetGuide && chart.drilldown ? selectedTargetGuide.id : 'Total'}
                            </span>
                            <span className="text-sm font-black text-slate-900 mt-1">{chart.center}</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {chart.data.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (chart.drilldown && !selectedTargetGuide) {
                                  setSelectedTargetCategory(item.name);
                                  setSelectedTargetGroup(null);
                                }
                                else if (chart.drilldown && selectedTargetGuide && !selectedTargetGroupGuide && item.groupId) setSelectedTargetGroup(item.groupId);
                              }}
                              className={`w-full flex items-center justify-between gap-3 bg-white rounded-xl px-4 py-3 border border-slate-100 text-left ${chart.drilldown && !selectedTargetGroupGuide ? 'hover:border-slate-300 hover:text-slate-900 transition-colors' : ''}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                <span className="text-xs font-black text-slate-700 truncate">{item.name}</span>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-black text-slate-900">{item.percent.toFixed(1)}%</p>
                                <p className="text-[10px] font-bold text-slate-400">{formatMoney(item.value, 'KRW')}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {targetViewMode === 'table' && (
              <div className="divide-y divide-slate-50">
                {targetPortfolioGuide.map((category) => (
                  <div key={category.id} className="p-5 md:p-7 space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr_auto] gap-3 lg:items-end">
                      <div>
                        <p className="text-sm md:text-base font-black text-slate-900">{category.id}</p>
                        <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-1">
                          현재 {category.currentPercent.toFixed(1)}% / 목표 {Number(category.percent || 0).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                          목표 비중
                        </label>
                        <input
                          inputMode="decimal"
                          value={category.percent}
                          onChange={(e) => updateTargetCategoryPercent(category.id, e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-sm font-black text-slate-800"
                        />
                      </div>
                      <button
                        onClick={() => removeTargetCategory(category.id)}
                        className="px-4 py-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors justify-self-start lg:justify-self-end"
                        title="분류 삭제"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">현재 가치</p>
                        <p className="text-lg font-black text-slate-800">{formatMoney(category.currentValue, 'KRW')}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">목표 가치</p>
                        <p className="text-lg font-black text-slate-900">{formatMoney(category.targetValue, 'KRW')}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{category.gapValue >= 0 ? '추가 필요 금액' : '목표 초과 금액'}</p>
                        <p className={`text-lg font-black ${category.gapValue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {formatMoney(Math.abs(category.gapValue), 'KRW')}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs md:text-sm font-black text-slate-800">분류 안 폴더 목표</p>
                          <p className={`text-[10px] md:text-xs font-bold mt-1 ${Math.abs(category.groupTotalPercent - 100) < 0.001 || category.groups.length === 0 ? 'text-slate-400' : 'text-amber-600'}`}>
                            폴더 목표 합계 {category.groupTotalPercent.toFixed(1)}%
                          </p>
                        </div>
                        <button
                          onClick={() => addTargetGroup(category.id)}
                          className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-black text-xs flex items-center gap-2 hover:bg-slate-200 transition-colors"
                        >
                          <Plus size={14} /> 폴더 추가
                        </button>
                      </div>

                      {category.groups.map((group) => (
                        <div key={group.id} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 md:p-5 space-y-3">
                          <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.5fr_auto_auto] gap-2 lg:items-center">
                            <div className="flex items-center gap-2 min-w-0">
                              <Folder size={17} className="text-slate-500 shrink-0" />
                              <input
                                value={group.name}
                                onChange={(e) => updateTargetGroup(category.id, group.id, { name: e.target.value })}
                                placeholder="폴더명 예: 빅테크"
                                className="w-full px-3 py-2.5 bg-white border border-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-black"
                              />
                            </div>
                            <input
                              inputMode="decimal"
                              value={group.percent}
                              onChange={(e) => updateTargetGroup(category.id, group.id, { percent: sanitizeNumericInput(e.target.value) })}
                              placeholder="폴더 비중 %"
                              className="px-3 py-2.5 bg-white border border-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold"
                            />
                            <button
                              onClick={() => addTargetItem(category.id, group.id)}
                              className="px-3 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
                            >
                              <Plus size={13} /> 종목
                            </button>
                            <button
                              onClick={() => removeTargetGroup(category.id, group.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                              title="폴더 삭제"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[10px] md:text-xs font-black">
                            <span className="bg-white rounded-xl px-3 py-2 text-slate-500">폴더 목표 {Number(group.percent || 0).toFixed(1)}%</span>
                            <span className="bg-white rounded-xl px-3 py-2 text-slate-900">목표 {formatMoney(group.targetValue, 'KRW')}</span>
                            <span className="bg-white rounded-xl px-3 py-2 text-slate-500">현재 {formatMoney(group.currentValue, 'KRW')}</span>
                            <span className={`${Math.abs(group.itemTotalPercent - 100) < 0.001 || group.items.length === 0 ? 'text-slate-500' : 'text-amber-600'} bg-white rounded-xl px-3 py-2`}>
                              종목 합계 {group.itemTotalPercent.toFixed(1)}%
                            </span>
                          </div>

                          <div className="space-y-2 pl-3 md:pl-5 border-l-2 border-slate-200">
                            {group.items.map((item) => (
                              <div key={item.id} className="grid grid-cols-1 lg:grid-cols-[1fr_0.8fr_0.55fr_0.8fr_auto] gap-2 bg-white border border-slate-100 rounded-2xl p-3">
                                <input
                                  value={item.name}
                                  onChange={(e) => updateTargetItem(category.id, group.id, item.id, { name: e.target.value })}
                                  placeholder="종목명"
                                  className="px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold"
                                />
                                <input
                                  value={item.ticker}
                                  onChange={(e) => updateTargetItem(category.id, group.id, item.id, { ticker: e.target.value.toUpperCase() })}
                                  placeholder="티커"
                                  className="px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold"
                                />
                                <input
                                  inputMode="decimal"
                                  value={item.percent}
                                  onChange={(e) => updateTargetItem(category.id, group.id, item.id, { percent: sanitizeNumericInput(e.target.value) })}
                                  placeholder="%"
                                  className="px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold"
                                />
                                <div className="px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs md:text-sm font-bold text-slate-700">
                                  {item.currentPriceKRW > 0 ? (
                                    <>
                                      <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">자동 현재가</span>
                                      <span>{formatMoney(item.currentPriceKRW, 'KRW')}</span>
                                      {item.currency && item.currency !== 'KRW' && (
                                        <span className="block text-[10px] text-slate-500 mt-0.5">{formatMoney(item.currentPriceNative, item.currency)}</span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-slate-400">티커 입력 시 자동 연동</span>
                                  )}
                                </div>
                                <button
                                  onClick={() => removeTargetItem(category.id, group.id, item.id)}
                                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                                  title="종목 삭제"
                                >
                                  <Trash2 size={15} />
                                </button>
                                <div className="lg:col-span-5 grid grid-cols-1 md:grid-cols-4 gap-2 text-[10px] md:text-xs font-black">
                                  <span className="bg-slate-50 rounded-xl px-3 py-2 text-slate-500">현재 {formatMoney(item.currentValue, 'KRW')}</span>
                                  <span className="bg-slate-50 rounded-xl px-3 py-2 text-slate-900">목표 {formatMoney(item.targetValue, 'KRW')}</span>
                                  <span className={`bg-slate-50 rounded-xl px-3 py-2 ${item.gapValue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {item.gapValue >= 0 ? '추가 필요' : '목표 초과'} {formatMoney(Math.abs(item.gapValue), 'KRW')}
                                  </span>
                                  <span className={`bg-slate-50 rounded-xl px-3 py-2 ${
                                    item.adjustmentSide === 'buy'
                                      ? 'text-emerald-600'
                                      : item.adjustmentSide === 'sell'
                                        ? 'text-rose-600'
                                        : 'text-slate-500'
                                  }`}>
                                    {item.adjustmentSide === 'buy'
                                      ? `매수 필요 ${item.adjustmentQuantity.toFixed(3)}주 / ${formatMoney(Math.abs(item.gapValue), 'KRW')}`
                                      : item.adjustmentSide === 'sell'
                                        ? `매도 필요 ${item.adjustmentQuantity.toFixed(3)}주 / ${formatMoney(Math.abs(item.gapValue), 'KRW')}`
                                        : '조정 필요 없음'}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {group.items.length === 0 && (
                              <p className="px-3 py-4 text-xs font-bold text-slate-400">이 폴더에 종목을 추가하세요.</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <React.Suspense
            fallback={(
              <div className="surface-panel p-10 text-center text-sm font-bold text-slate-400">
                메모장을 불러오는 중입니다...
              </div>
            )}
          >
            <MemoTab
              memos={visibleMemos}
              stockOptions={memoStockOptions}
              stockFilter={memoStockFilter}
              onStockFilterChange={setMemoStockFilter}
              sortMode={memoSortMode}
              onSortModeChange={setMemoSortMode}
              sortOptions={TRADE_SORT_OPTIONS}
              summary={memoSummary}
              manualMemo={manualMemo}
              onManualMemoChange={setManualMemo}
              onAddManualMemo={handleAddManualMemo}
              onRemoveMemo={removeMemo}
              onUpdateMemo={updateMemoText}
              formatMoney={formatMoney}
            />
          </React.Suspense>
        )}

        {activeTab === 'calendar' && (
          <div className="surface-panel overflow-hidden animate-in fade-in duration-500">
            <div className="section-header p-5 md:p-7 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
                  <CalendarDays size={18} className="text-blue-600" />
                  배당 캘린더
                </h3>
                <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-1">공시 주당 분배금과 배당락일 보유수량으로 계산하고, 세금은 계좌·과표 기준을 적용합니다.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCalendarMonth(getMonthKey(addMonths(new Date(`${calendarMonth}-01T00:00:00`), -1)))}
                  className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-[10px] md:text-xs font-black text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  이전
                </button>
                <div className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs md:text-sm font-black min-w-28 text-center">
                  {calendarMonth}
                </div>
                <button
                  onClick={() => setCalendarMonth(getMonthKey(addMonths(new Date(`${calendarMonth}-01T00:00:00`), 1)))}
                  className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-[10px] md:text-xs font-black text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  다음
                </button>
              </div>
            </div>

            <div className="p-4 md:p-7">
              <div className="grid grid-cols-7 gap-1.5 md:gap-2 mb-2">
                {CALENDAR_WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="text-center text-[10px] md:text-xs font-black text-slate-400 py-2">
                    {weekday}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5 md:gap-2">
                {dividendCalendarCells.map((cell) => {
                  const events = dividendCalendarEventsByDate[cell.dateKey] || [];
                  return (
                    <div
                      key={cell.dateKey}
                      className={`min-h-20 md:min-h-28 rounded-xl border p-2 transition-colors ${cell.isCurrentMonth ? 'bg-white border-slate-100' : 'bg-slate-50/60 border-slate-50 text-slate-300'}`}
                    >
                      <div className={`text-[10px] md:text-xs font-black mb-1.5 ${cell.isCurrentMonth ? 'text-slate-500' : 'text-slate-300'}`}>
                        {cell.day}
                      </div>
                      <div className="space-y-1">
                        {events.slice(0, 3).map((event) => (
                          <button
                            key={event.id}
                            onClick={() => setSelectedCalendarEventId(event.id)}
                            title={`${event.name} 세전 ${formatMoney(event.grossAmount, event.currency)} / 세후 계산 ${formatMoney(event.netAmount, event.currency)}`}
                            className={`w-full truncate rounded-lg px-2 py-1 text-[10px] md:text-xs font-black text-left transition-colors ${selectedCalendarEvent?.id === event.id ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                          >
                            {event.name}
                          </button>
                        ))}
                        {events.length > 3 && (
                          <span className="block text-[9px] font-black text-slate-400 px-1">+{events.length - 3}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 md:mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-5 md:p-6">
                {selectedCalendarEvent ? (
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">{selectedCalendarEvent.date} · {selectedCalendarEvent.dateLabel}</p>
                      <h4 className="text-lg md:text-xl font-black text-slate-900">{selectedCalendarEvent.name}</h4>
                      <p className="text-xs md:text-sm font-bold text-slate-500 mt-1">
                        {selectedCalendarEvent.ticker}
                        {selectedCalendarEvent.quantity > 0
                          ? ` · ${selectedCalendarEvent.quantity.toLocaleString()}주 기준`
                          : ' · 직접 실수령 기록'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 min-w-full md:min-w-80">
                      <div className="bg-white border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">세전 계산</p>
                        <p className="text-base md:text-lg font-black text-slate-900">
                          {selectedCalendarEvent.grossAmount === null
                            ? '-'
                            : formatMoney(selectedCalendarEvent.grossAmount, selectedCalendarEvent.currency)}
                        </p>
                      </div>
                      <div className="bg-white border border-slate-100 rounded-xl p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">세후 계산</p>
                        <p className="text-base md:text-lg font-black text-blue-600">{formatMoney(selectedCalendarEvent.netAmount, selectedCalendarEvent.currency)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-xs md:text-sm font-bold text-slate-400">해당 월에 공시된 배당락일 또는 지급일 기록이 없습니다.</p>
                )}
              </div>
            </div>
          </div>
        )}
          </div>
          {privacyMode && (
            <div className="absolute inset-x-0 top-10 z-10 flex justify-center px-4">
              <button
                type="button"
                onClick={() => setPrivacyMode(false)}
                className="rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 text-xs md:text-sm font-black text-slate-700 shadow-lg backdrop-blur hover:bg-white"
              >
                금액이 가려져 있습니다 · 눌러서 보기
              </button>
            </div>
          )}
        </main>
      </div>

      {/* 자산 추가 모달 */}
{isAdding && (
  <div className="modal-backdrop">
    <div role="dialog" aria-modal="true" aria-label="새 자산 등록" className="modal-card modal-card--large p-6 md:p-8">
      <div className="flex justify-between items-center mb-6 md:mb-8 sticky top-0 bg-white z-10 pt-2 pb-2">
        <h3 className="text-lg md:text-xl font-black text-slate-900">새 자산 등록</h3>
        <button
          type="button"
          aria-label="새 자산 등록 닫기"
          onClick={() => {
            setIsAdding(false);
          }}
          className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
              자산 구분
            </label>
            <select
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm"
              value={newAsset.category}
              onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value })}
            >
              <option value="국내주식">국내주식</option>
              <option value="해외주식">해외주식</option>
              <option value="원자재">원자재 (금, 은 등)</option>
              <option value="현금">현금 (CASH)</option>
            </select>
          </div>

          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
              통화 (Currency)
            </label>
            <select
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm"
              value={newAsset.currency}
              onChange={(e) => setNewAsset({ ...newAsset, currency: e.target.value })}
            >
              <option value="KRW">원화 (KRW)</option>
              <option value="USD">달러 (USD)</option>
              <option value="JPY">엔화 (JPY)</option>
            </select>
          </div>
        </div>

        <div className="relative">
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            {newAsset.category === '현금' ? '계좌명' : '종목명'}
          </label>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-3.5 text-slate-400" />
            <input
              type="text"
              className="w-full pl-11 pr-4 py-2.5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm"
              value={newAsset.name}
              onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
            />
          </div>
        </div>

        {newAsset.category !== '현금' && (
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
              티커 심볼
            </label>
            <input
              type="text"
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold uppercase text-xs md:text-sm text-slate-800"
              value={newAsset.ticker}
              onChange={(e) => setNewAsset({ ...newAsset, ticker: e.target.value.toUpperCase() })}
            />
          </div>
        )}

        {newAsset.category !== '현금' && (
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
              평균 단가 ({getCurrencySymbol(newAsset.currency)})
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm"
              value={formatInputNumber(newAsset.averagePrice)}
              onChange={(e) =>
                setNewAsset({
                  ...newAsset,
                  averagePrice: sanitizeNumericInput(e.target.value)
                })
              }
            />
          </div>
        )}

        <div className={newAsset.category === '현금' ? 'col-span-2' : ''}>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            {newAsset.category === '현금' ? `금액 (${newAsset.currency})` : '매수 수량'}
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm"
            value={formatInputNumber(newAsset.quantity)}
            onChange={(e) =>
              setNewAsset({
                ...newAsset,
                quantity: sanitizeNumericInput(e.target.value)
              })
            }
          />
        </div>

        <div className="border-t border-slate-100 pt-4 mt-2">
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
              매수일
            </label>
            <input
              type="date"
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-800"
              value={newAsset.buyDate}
              onChange={(e) => setNewAsset({ ...newAsset, buyDate: e.target.value })}
            />
          </div>

        </div>

        <details className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <summary className="cursor-pointer text-xs md:text-sm font-black text-slate-700">
            계좌·세금·환율 세부 정보
          </summary>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
              계좌명
              <input
                type="text"
                className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                value={newAsset.accountName}
                onChange={(e) => setNewAsset({ ...newAsset, accountName: e.target.value })}
                placeholder="예: KB 해외주식"
              />
            </label>
            <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
              계좌 유형
              <select
                className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                value={newAsset.accountType}
                onChange={(e) => setNewAsset({ ...newAsset, accountType: e.target.value })}
              >
                <option value="GENERAL">일반 계좌</option>
                <option value="ISA">ISA</option>
                <option value="PENSION">연금 계좌</option>
                <option value="IRP">IRP</option>
              </select>
            </label>

            {newAsset.category !== '현금' && (
              <>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  원천징수 국가
                  <select
                    className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                    value={newAsset.sourceCountry}
                    onChange={(e) => setNewAsset({ ...newAsset, sourceCountry: e.target.value })}
                  >
                    <option value="">종목 기준 자동</option>
                    <option value="KR">대한민국</option>
                    <option value="US">미국</option>
                    <option value="DK">덴마크</option>
                    <option value="JP">일본</option>
                  </select>
                </label>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  증권 유형
                  <select
                    className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                    value={newAsset.securityType}
                    onChange={(e) => setNewAsset({ ...newAsset, securityType: e.target.value })}
                  >
                    <option value="">종목 기준 자동</option>
                    <option value="STOCK">주식</option>
                    <option value="ETF">ETF</option>
                    <option value="ADR">ADR</option>
                  </select>
                </label>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  배당 원천세율 (%)
                  <input
                    type="text"
                    inputMode="decimal"
                    className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                    value={formatInputNumber(newAsset.dividendTaxRate)}
                    onChange={(e) => setNewAsset({ ...newAsset, dividendTaxRate: sanitizeNumericInput(e.target.value) })}
                    placeholder="비우면 자동"
                  />
                </label>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  주당 과표증분 (원)
                  <input
                    type="text"
                    inputMode="decimal"
                    className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                    value={formatInputNumber(newAsset.dividendTaxBasisPerShare)}
                    onChange={(e) => setNewAsset({ ...newAsset, dividendTaxBasisPerShare: sanitizeNumericInput(e.target.value) })}
                    placeholder="국내 상장 해외 ETF만 입력"
                    title="국내 상장 해외자산 ETF는 분배금 전체가 아니라 과표기준가 증분에 과세됩니다."
                  />
                </label>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  ADR 수수료 / 주
                  <input
                    type="text"
                    inputMode="decimal"
                    className="mt-1.5 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 text-xs md:text-sm font-bold text-slate-800 normal-case tracking-normal"
                    value={formatInputNumber(newAsset.adrFeePerShare)}
                    onChange={(e) => {
                      const adrFeePerShare = sanitizeNumericInput(e.target.value);
                      setNewAsset({
                        ...newAsset,
                        adrFeePerShare,
                        adrFeePerShareExplicit: adrFeePerShare.trim() !== '',
                      });
                    }}
                    placeholder="비우면 자동"
                  />
                </label>
              </>
            )}

          </div>
        </details>

        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매수 메모
          </label>
          <textarea
            rows="3"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm resize-none"
            placeholder="매수 근거를 간단히 남겨두세요."
            value={newAsset.memo}
            onChange={(e) => setNewAsset({ ...newAsset, memo: e.target.value })}
          />
        </div>
        <button
          onClick={handleAddAsset}
          className="w-full mt-6 px-6 py-3.5 md:py-4 bg-slate-900 text-white rounded-xl md:rounded-2xl font-black text-xs md:text-sm shadow-sm hover:scale-[1.02] transition-all uppercase tracking-widest"
        >
          포트폴리오에 반영하기
        </button>
      </div>
    </div>
  </div>
)}

{/* 매수 기록 관리 모달 */}
{selectedAssetToManageBuys && (
  <div className="modal-backdrop z-[105]">
    <div role="dialog" aria-modal="true" aria-label={`${selectedAssetToManageBuys.name} 매수 기록 관리`} className="modal-card modal-card--wide p-5 md:p-7 flex flex-col">
      <div className="flex justify-between items-start gap-4 mb-5 md:mb-6">
        <div className="min-w-0">
          <h3 className="text-lg md:text-xl font-black text-slate-900 truncate">
            {selectedAssetToManageBuys.name} 매수 기록
          </h3>
          <p className="text-[10px] md:text-xs text-slate-400 font-black mt-1 uppercase tracking-[0.14em] truncate">
            {selectedAssetToManageBuys.ticker || '-'} · {buyLotDrafts.length.toLocaleString()}개 기록
          </p>
        </div>
        <button
          type="button"
          aria-label="매수 기록 관리 닫기"
          onClick={closeBuyLotsModal}
          className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4 md:mb-5">
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">총 매수수량</p>
          <p className="mt-1 text-sm md:text-base font-black text-slate-900">
            {buyLotDraftSummary.totalQuantity.toLocaleString()}{selectedAssetToManageBuys.category === '원자재' ? '단위' : '주'}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">평단</p>
          <p className="mt-1 text-sm md:text-base font-black text-slate-900">
            {formatMoney(buyLotDraftSummary.averagePrice, selectedAssetToManageBuys.currency)}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">최초 매수일</p>
          <p className="mt-1 text-sm md:text-base font-black text-slate-900">
            {buyLotDrafts.map(lot => lot.date).filter(Boolean).sort()[0] || '-'}
          </p>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <div className="hidden md:grid grid-cols-[1.05fr_1fr_1fr_1fr_44px] gap-3 px-2 pb-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
          <span>매수일</span>
          <span className="text-right">단가</span>
          <span className="text-right">수량</span>
          <span className="text-right">매수금액</span>
          <span></span>
        </div>
        <div className="space-y-3">
          {buyLotDrafts.map((lot, index) => {
            const lotQuantity = parseNumber(lot.quantity);
            const lotPrice = parseNumber(lot.price);
            const lotAmount = lotQuantity * lotPrice;

            return (
              <div key={lot.draftId} className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr_1fr_1fr_44px] gap-2 md:gap-3 items-end rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div>
                  <label className="md:hidden block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">매수일</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-800"
                    value={lot.date}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'date', e.target.value)}
                  />
                </div>
                <div>
                  <label className="md:hidden block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">단가</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.price)}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'price', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div>
                  <label className="md:hidden block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">수량</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.quantity)}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'quantity', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-white border border-slate-100 text-right">
                  <p className="md:hidden text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">매수금액</p>
                  <p className="font-black text-slate-800 text-xs md:text-sm">
                    {formatMoney(lotAmount, selectedAssetToManageBuys.currency)}
                  </p>
                </div>
                <button
                  onClick={() => removeBuyLotDraft(lot.draftId)}
                  disabled={buyLotDrafts.length <= 1}
                  className="h-10 md:h-11 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                  title={`${index + 1}번째 매수 기록 삭제`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:gap-3 mt-5 md:mt-6">
        <button
          onClick={addBuyLotDraft}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-xs md:text-sm transition-colors"
        >
          <Plus size={16} /> 매수 기록 추가
        </button>
        <button
          onClick={handleSaveBuyLots}
          className="flex-1 px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs md:text-sm shadow-sm hover:scale-[1.01] transition-all uppercase tracking-widest"
        >
          매수 기록 저장하기
        </button>
      </div>
    </div>
  </div>
)}

{/* 추가 매수 모달 */}
{isUpdatingAsset && selectedAssetToUpdate && (
  <div className="modal-backdrop z-[110]">
    <div role="dialog" aria-modal="true" aria-label={`${selectedAssetToUpdate.name} 추가 매수`} className="modal-card max-w-md p-6 md:p-8">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <h3 className="text-lg md:text-xl font-black text-slate-900">
          {selectedAssetToUpdate.name} 추가 매수
        </h3>
        <button
          type="button"
          aria-label="추가 매수 닫기"
          onClick={() => {
            setIsUpdatingAsset(false);
            setSelectedAssetToUpdate(null);
          }}
          className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            추가 매수 단가 ({getCurrencySymbol(selectedAssetToUpdate.currency)})
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm"
            value={formatInputNumber(addBuyForm.averagePrice)}
            onChange={(e) =>
              setAddBuyForm((prev) => ({
                ...prev,
                averagePrice: sanitizeNumericInput(e.target.value)
              }))
            }
          />
        </div>

        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            추가 매수 수량
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm"
            value={formatInputNumber(addBuyForm.quantity)}
            onChange={(e) =>
              setAddBuyForm((prev) => ({
                ...prev,
                quantity: sanitizeNumericInput(e.target.value)
              }))
            }
          />
        </div>

        <div className="border-t border-slate-100 pt-4 mt-2">
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            추가 매수일
          </label>
          <input
            type="date"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-800"
            value={addBuyForm.buyDate}
            onChange={(e) =>
              setAddBuyForm((prev) => ({
                ...prev,
                buyDate: e.target.value
              }))
            }
          />
        </div>

      </div>


        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매수 메모
          </label>
          <textarea
            rows="3"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm resize-none"
            placeholder="추가 매수 근거를 간단히 남겨두세요."
            value={addBuyForm.memo}
            onChange={(e) =>
              setAddBuyForm((prev) => ({
                ...prev,
                memo: e.target.value
              }))
            }
          />
        </div>
      <button
        onClick={handleAddBuyToAsset}
        className="w-full mt-6 px-6 py-3.5 md:py-4 bg-slate-900 text-white rounded-xl md:rounded-2xl font-black text-xs md:text-sm shadow-sm hover:scale-[1.02] transition-all uppercase tracking-widest"
      >
        추가 매수 반영하기
      </button>
    </div>
  </div>
)}

{/* 매도 모달 */}
{isSellingAsset && selectedAssetToSell && (
  <div className="modal-backdrop z-[120]">
    <div role="dialog" aria-modal="true" aria-label={`${selectedAssetToSell.name} 매도`} className="modal-card max-w-md p-6 md:p-8">
      <div className="flex justify-between items-center gap-4 mb-6 md:mb-8">
        <h3 className="text-lg md:text-xl font-black text-slate-900 whitespace-nowrap">
          {selectedAssetToSell.name} 매도
        </h3>
        <button
          type="button"
          aria-label="매도 닫기"
          onClick={() => {
            setIsSellingAsset(false);
            setSelectedAssetToSell(null);
          }}
          className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매도 단가 ({getCurrencySymbol(selectedAssetToSell.currency)})
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm"
            value={formatInputNumber(sellForm.sellPrice)}
            onChange={(e) =>
              setSellForm((prev) => ({
                ...prev,
                sellPrice: sanitizeNumericInput(e.target.value)
              }))
            }
          />
        </div>

        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매도 수량
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-black text-slate-900 text-xs md:text-sm"
            value={formatInputNumber(sellForm.quantity)}
            onChange={(e) =>
              setSellForm((prev) => ({
                ...prev,
                quantity: sanitizeNumericInput(e.target.value)
              }))
            }
          />
        </div>

        <div className="border-t border-slate-100 pt-4 mt-2">
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매도일
          </label>
          <input
            type="date"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm text-slate-800"
            value={sellForm.sellDate}
            onChange={(e) =>
              setSellForm((prev) => ({
                ...prev,
                sellDate: e.target.value
              }))
            }
          />
        </div>

      </div>


        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매도 메모
          </label>
          <textarea
            rows="3"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-slate-300 font-bold text-xs md:text-sm resize-none"
            placeholder="매도 근거를 간단히 남겨두세요."
            value={sellForm.memo}
            onChange={(e) =>
              setSellForm((prev) => ({
                ...prev,
                memo: e.target.value
              }))
            }
          />
        </div>
      <button
        onClick={handleSellAsset}
        className="w-full mt-6 px-6 py-3.5 md:py-4 bg-slate-900 text-white rounded-xl md:rounded-2xl font-black text-xs md:text-sm shadow-sm hover:scale-[1.02] transition-all uppercase tracking-widest"
      >
        매도 반영하기
      </button>
    </div>
  </div>
      )}
    </div>
  );
};

export default App;
