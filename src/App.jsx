import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Minus, TrendingUp, TrendingDown, Trash2,
  PieChart as PieIcon,
  Receipt, Wallet, ArrowLeft, X, Banknote, DollarSign, ArrowRightLeft, Search, Folder, Target, CalendarDays,
  ChevronLeft, ChevronRight, NotebookPen, Pencil, PlusCircle, Sparkles
} from 'lucide-react';
import DashboardHeader from './components/DashboardHeader';
import ModalOverlay from './components/ModalOverlay';
import UserSettingsPanel from './components/UserSettingsPanel';
import AnnualReturnGoalCard from './components/AnnualReturnGoalCard';
import AnnualReturnHistory from './components/AnnualReturnHistory';
import DividendIncomeSummary from './components/DividendIncomeSummary';
import { resolveDividendIncomeRate, summarizeDividendIncome } from './utils/dividendIncome.js';
import { calculateAnnualIncomeReturn, getAnnualTradeYears } from './utils/annualIncomeReturn.js';
import BrokerFeeFields from './components/BrokerFeeFields';
import BuyLotsEditor from './components/BuyLotsEditor';
import AnnualDividendTrend from './components/AnnualDividendTrend';
import DividendSummaryGrid from './components/DividendSummaryGrid';
import FeatureInfo from './components/FeatureInfo';
import ManualTradeEntryForm from './components/ManualTradeEntryForm';
import MarketCalendar from './components/MarketCalendar';
import StockFilterCombobox from './components/StockFilterCombobox';
import StockInsightPanel from './components/StockInsightPanel';
import SyncStatusToast from './components/SyncStatusToast';
import TabNav from './components/TabNav';
import TradeRecordEditor from './components/TradeRecordEditor';
import { useAuth } from './context/useAuth';
import useTheme from './hooks/useTheme';
import usePortfolioCloudSync from './hooks/usePortfolioCloudSync';
import PortfolioSaveStatus from './components/PortfolioSaveStatus';
import { readPortfolioJournal } from './utils/portfolioSyncJournal';
import { formatKoreanDate } from './utils/dates';
import { editBuyLot, resolveBuyLotFxRate } from './utils/buyLotEditing';
import { PORTFOLIO_CURRENCIES, resolveManualTradeAsset } from './utils/currencies';
import {
  AUTO_DIVIDENDS_STORAGE_KEY,
  ASSETS_STORAGE_KEY,
  CAPITAL_FLOWS_STORAGE_KEY,
  CONFIRMED_DIVIDENDS_STORAGE_KEY,
  DEFAULT_PORTFOLIO_NAME,
  DIVIDEND_ASSET_REGISTRY_STORAGE_KEY,
  getCategoryColor,
  LEGACY_PORTFOLIO_NAMES,
  getCategoryDetailColor,
  isPortfolioAssetCategory,
  isRemovedAssetCategory,
  MARKET_CALENDAR_KEYWORDS_STORAGE_KEY,
  MEMOS_STORAGE_KEY,
  PORTFOLIO_ASSET_CATEGORIES,
  PORTFOLIO_NAME_STORAGE_KEY,
  PORTFOLIO_SNAPSHOTS_STORAGE_KEY,
  PREFERRED_BROKER_STORAGE_KEY,
  TARGET_PORTFOLIO_STORAGE_KEY,
  TRADE_LEDGER_STORAGE_KEY,
  TRADES_STORAGE_KEY,
} from './constants';
import {
  fetchDividends,
  fetchKrwRate,
  fetchKrwRateByDate,
  fetchStockQuote,
  fetchTradingViewQuotes,
  fetchUsdKrwRate,
  fetchUsdKrwRateByDate,
} from './services/marketData';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from './utils/formatters';
import {
  claimLegacyStorageKeys,
  getScopedStorageKey,
  hasStoredKey,
  loadJson,
  moveStorageScope,
  saveJson,
  setStorageErrorHandler,
} from './utils/storage';
import {
  buildCanonicalTradeRows,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  getTradeRound,
  recoverMissingAssetsFromTradeLedger,
  reconcileAssetsAfterTradeDeletion,
  reconcileAssetsWithTradeLedger,
  resolveNextTradeRound,
  resolveTradeRowKrwRate,
  scaleManualPurchaseKRW,
} from './utils/tradeReconciliation';
import {
  TRADE_PAGE_SIZE,
  getRecordDate,
  getRecordPnl,
  getTradeSide,
} from './utils/tradeRecordView';
import CalendarTab from './components/tabs/CalendarTab.jsx';
import PortfolioTab from './components/tabs/PortfolioTab.jsx';
import RemoveAssetConfirmModal from './components/modals/RemoveAssetConfirmModal.jsx';
import SellAssetModal from './components/modals/SellAssetModal.jsx';
import PriceInputCurrencyToggle from './components/PriceInputCurrencyToggle.jsx';
import AddAssetModal from './components/modals/AddAssetModal.jsx';
import DividendEntryModal from './components/modals/DividendEntryModal.jsx';
import AddBuyModal from './components/modals/AddBuyModal.jsx';
import HistoryTab from './components/tabs/HistoryTab.jsx';
import TargetTab from './components/tabs/TargetTab.jsx';
import { buildLivePriceUpdate, summarizePriceSync } from './utils/livePriceSync';
import { buildTradeSummary } from './utils/tradeSummary';
import {
  DEFAULT_BROKER_ID,
  calculateSellCosts,
  formatFeeRateInput,
  getBrokerFeeRatePercent,
  getBrokerPreset,
  getSellTaxRatePercent,
  deriveFeeRatePercent,
  resolveKnownFeeAmount,
  roundTradeCost,
} from './utils/tradeCosts';
import {
  selectDividendMonthEvents,
  summarizeDividendCalendarEvents,
} from './utils/dividendCalendar';
import {
  buildAnnualDividendEvents,
  summarizeAnnualDividendTrend,
} from './utils/annualDividendTrend';
import { buildStockSearchOptions } from './utils/stockSearchOptions';
import { calculateOverseasCapitalGainsTax } from './utils/overseasCapitalGainsTax';
import { combineTradesWithMemos } from './utils/tradeMemos';
import {
  buildTradeRecordEditPatch,
  countUnmatchedSells,
  getEditableTradeFields,
  toLegacySellTradePatch,
  validateTradeRecordEdit,
} from './utils/tradeRecordEditing';
import {
  isDeletedMemoRecord,
  selectActiveMemoRecords,
} from './utils/memoRecords';
import { getDividendRefreshState, getDividendRefreshVersion } from './utils/dividendRefresh';
import { isRecordForAsset } from './utils/assetIdentity';
import {
  createMarketCalendarKeyword,
  normalizeMarketCalendarKeywords,
} from './utils/marketCalendar';
import {
  calculateDividendAmounts,
  isKoreanDividendSmallWithholdingApplicable,
  KOREAN_DIVIDEND_INCOME_TAX_RATE,
  KOREAN_DIVIDEND_SMALL_WITHHOLDING_THRESHOLD,
} from './utils/dividendCalculation';
import {
  ACCOUNT_TYPE_GENERAL,
  ACCOUNT_TYPE_OPTIONS,
  isDividendTaxDeferredAccount,
  migrateUserConfirmedAccountTypes,
  normalizeAccountType,
} from './utils/accountTypes';
import {
  buildDividendCalculationAssets,
  getDividendHeldQuantityOnDate,
  getDividendLedgerRows,
  getDividendTradeSide,
} from './utils/dividendHoldings';
import {
  getDividendEligibilityDate,
  getDividendOfficialPaymentDate,
  getDividendReportingDate,
} from './utils/dividendDates';
import {
  getAutomaticDividendEventKey,
  mergeAutomaticDividendRecords,
  mergeDividendRecords,
  normalizeDividendValidationRecords,
  selectFormulaDividendRecords,
  selectReportedDividendRecords,
  selectReceivedDividendRecords,
  selectUserEnteredDividendRecords,
} from './utils/dividendRecords';
import { usePortfolioMetrics } from './hooks/usePortfolioMetrics';
import { db } from './firebase';

// 과거 거래의 환율을 거래일 기준으로 한 번 고쳐 받았는지 표시하는 플래그.
const FX_RATE_REPAIR_STORAGE_KEY = 'portfolio.fxRateRepairedV1';
const ANNUAL_DIVIDEND_FX_RATES_STORAGE_KEY = 'portfolio.annualDividendFxRatesV1';

const isDomesticStockCategory = (category) => category?.includes('국내') && category?.includes('주식');


const PORTFOLIO_STORAGE_KEYS = [
  ASSETS_STORAGE_KEY,
  TRADES_STORAGE_KEY,
  MEMOS_STORAGE_KEY,
  TRADE_LEDGER_STORAGE_KEY,
  AUTO_DIVIDENDS_STORAGE_KEY,
  CONFIRMED_DIVIDENDS_STORAGE_KEY,
  DIVIDEND_ASSET_REGISTRY_STORAGE_KEY,
  PORTFOLIO_NAME_STORAGE_KEY,
  TARGET_PORTFOLIO_STORAGE_KEY,
  CAPITAL_FLOWS_STORAGE_KEY,
  PORTFOLIO_SNAPSHOTS_STORAGE_KEY,
  MARKET_CALENDAR_KEYWORDS_STORAGE_KEY,
];

// 로그인하지 않은 상태에서 쓰는 저장 영역. 계정 영역과 절대 섞이면 안 된다.
const GUEST_STORAGE_SCOPE = 'guest';

// 클라우드 저장 실패는 대부분 일시적인 네트워크 문제다. 재시도가 없으면 방금 추가한
// 자산이 이 기기에만 남고, 나중에 원격 스냅샷에 덮여 사라진다.

// 가상화폐 기능을 제거하면서, 기존에 남아 있는 가상화폐 데이터를 1회 정리한다.
const CRYPTO_CATEGORY = '가상화폐';
const CRYPTO_PURGE_FLAG_KEY = 'portfolio_crypto_purged_v1';
const isCryptoCategory = (category = '') => String(category || '').trim() === CRYPTO_CATEGORY;

// 저장돼 있던 옛 기본 이름은 새 기본 이름으로 옮긴다.
const normalizePortfolioName = (name) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || LEGACY_PORTFOLIO_NAMES.includes(trimmed)) return DEFAULT_PORTFOLIO_NAME;
  return trimmed;
};

// 소수점 주식 수량 비교용 허용 오차(원장 계산의 EPSILON과 같은 값).
const QUANTITY_EPSILON = 0.000001;
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

const parseNumber = (value) => parseFloat(String(value || '').replace(/,/g, '')) || 0;
const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
/**
 * 거래 기록의 대표 날짜. utils/tradeReconciliation의 getTradeRecordDate와 반드시
 * 같은 우선순위여야 한다. 예전에는 App만 sellDate를 먼저 봐서, buyDate와 sellDate를
 * 함께 가진 레거시 기록을 화면 정렬과 원장 정렬이 서로 다르게 줄 세웠다.
 */
const numbersMatch = (left, right) => Math.abs(parseNumber(left) - parseNumber(right)) < 0.0001;
const findMatchingSellTrade = (memo, trades) => trades.find((trade) => {
  if (!memo.name || memo.name !== trade.name) return false;
  if (!memo.date || memo.date !== trade.sellDate) return false;
  if (parseNumber(memo.quantity) && !numbersMatch(memo.quantity, trade.quantity)) return false;
  if (parseNumber(memo.price) && !numbersMatch(memo.price, trade.sellPrice)) return false;
  return true;
});

const findMatchingMemoForLedger = (entry, memos) => memos.find((memo) => {
  if (isDeletedMemoRecord(memo)) return false;
  if (memo.ledgerId && (String(memo.ledgerId) === String(entry.id) || String(memo.ledgerId) === String(entry.sourceId))) return true;
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

const DEFAULT_TARGET_PORTFOLIO = {
  budget: '',
  categories: [
    { id: '국내주식', percent: 50 },
    { id: '해외주식', percent: 50 },
  ],
  items: {
    국내주식: [],
    해외주식: [],
  },
  groups: {
    국내주식: [],
    해외주식: [],
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
  fxRate = 0,
  grossPnl = null,
  brokerId = '',
  brokerName = '',
  brokerFeeRate = 0,
  brokerFeeRatePercent = 0,
  brokerFee = 0,
  sellTaxRatePercent = 0,
  sellTax = 0,
  buyFeeApplied = null,
}) => ({
  id: sourceId || `${Date.now()}-${Math.random()}`,
  sourceId,
  assetId: asset.id ?? asset.assetId ?? null,
  name: asset.name,
  ticker: asset.ticker || '',
  category: asset.category || '',
  currency: asset.currency || 'KRW',
  accountType: normalizeAccountType(asset.accountType),
  accountTypeSource: asset.accountTypeSource || '',
  // 보유 회차. 전량 매도 후 재매수한 같은 종목을 구분하는 기준값이다.
  round: getTradeRound(asset),
  side,
  action: side === 'sell' ? '매도' : '매수',
  quantity: Number(quantity) || 0,
  price: Number(price) || 0,
  date,
  pnl: Number(pnl) || 0,
  grossPnl: Number(grossPnl ?? pnl) || 0,
  brokerId,
  brokerName,
  brokerFeeRate: Number(brokerFeeRate) || 0,
  brokerFeeRatePercent: Number(brokerFeeRatePercent) || 0,
  brokerFee: Number(brokerFee) || 0,
  sellTaxRatePercent: Number(sellTaxRatePercent) || 0,
  sellTax: Number(sellTax) || 0,
  /**
   * 매도 행에만 붙는다. 이 매도 수량에 배분된 매수 수수료로, 실현손익에 이미 반영돼 있다.
   * 값이 없으면 아예 키를 만들지 않는다. 0으로 채워 두면 "수수료 0원으로 기록됨"이 되어
   * 실제로 낸 매수 수수료가 손익에서도 세금 필요경비에서도 통째로 증발한다.
   */
  ...(buyFeeApplied === null || buyFeeApplied === undefined || buyFeeApplied === ''
    ? {}
    : { buyFeeApplied: Number(buyFeeApplied) || 0 }),
  // 거래 시점의 원화 환율. 실현손익을 "오늘 환율"로 환산하면
  // 과거 누적 실현손익이 매일 바뀌므로 기록 시점 값을 함께 남긴다.
  fxRate: Number(fxRate) || 0,
  createdAt: new Date().toISOString(),
});

const buildInitialTradeLedger = ({ assets, trades, memos }) => {
  const entries = [];
  const pushOnce = (entry) => {
    if (!entry.name || !entry.date) return;
    if (entries.some((item) => item.sourceId === entry.sourceId)) return;
    entries.push(entry);
  };

  memos.forEach((memo) => {
    pushOnce(buildLedgerEntry({
      sourceId: memo.ledgerId || `memo-${memo.id}`,
      asset: memo,
      side: getTradeSide(memo),
      quantity: memo.quantity,
      price: memo.price,
      date: memo.date,
      pnl: getRecordPnl(memo),
      grossPnl: memo.grossPnl,
      brokerId: memo.brokerId,
      brokerName: memo.brokerName,
      brokerFeeRate: memo.brokerFeeRate,
      brokerFeeRatePercent: memo.brokerFeeRatePercent,
      brokerFee: memo.brokerFee,
      sellTaxRatePercent: memo.sellTaxRatePercent,
      sellTax: memo.sellTax,
      buyFeeApplied: memo.buyFeeApplied ?? null,
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
      grossPnl: trade.grossPnl,
      brokerId: trade.brokerId,
      brokerName: trade.brokerName,
      brokerFeeRate: trade.brokerFeeRate,
      brokerFeeRatePercent: trade.brokerFeeRatePercent,
      brokerFee: trade.brokerFee,
      sellTaxRatePercent: trade.sellTaxRatePercent,
      sellTax: trade.sellTax,
      buyFeeApplied: trade.buyFeeApplied ?? null,
    }));
  });

  assets.forEach((asset) => {
    const alreadyHasBuy = entries.some((entry) => (
      entry.side === 'buy'
      && entry.name === asset.name
      && entry.date === asset.buyDate
      && numbersMatch(entry.quantity, asset.quantity)
    ));
    if (alreadyHasBuy || !asset.buyDate || isRemovedAssetCategory(asset.category)) return;

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

// 회차까지 포함한 자산 식별자.
// 같은 삼성전자라도 "1차 / 2차"는 서로 다른 자산으로 다뤄 평단가가 섞이지 않게 한다.
const getAssetIdentity = (asset) => `${asset.ticker || ''}::${asset.name || ''}#${getTradeRound(asset)}`;

/**
 * 해외 종목 단가를 달러/원화 중 어느 쪽으로 입력할지 고르는 토글.
 * 원화를 고르면 매수일 환율로 환산한 결과를 바로 아래에 보여줘서
 * "원화로 적었는데 달러로 들어갔다"는 사고를 눈으로 막는다.
 */


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
      getTradeRound(record),
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

const mergeUniqueDividends = (primary = [], secondary = []) => {
  const seen = new Set();
  return [...primary, ...secondary].filter((dividend) => {
    const key = [
      dividend.id || '',
      dividend.name || '',
      dividend.ticker || '',
      getTradeRound(dividend),
      dividend.date || '',
      dividend.currency || '',
      dividend.quantity || '',
      dividend.perShareGrossAmount || '',
      dividend.grossAmount || '',
      dividend.amount || '',
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getDividendAssetKey = (record = {}) => (
  String(record.ticker || '').trim().toUpperCase()
  || String(record.name || '').trim().toUpperCase()
);

const mergeDividendResultsByAsset = (
  previousDividends = [],
  nextDividends = [],
  assets = [],
  invalidatedEventKeys = [],
) => {
  const activeAssetKeys = new Set(assets.map(getDividendAssetKey).filter(Boolean));
  return mergeAutomaticDividendRecords(nextDividends, previousDividends, {
    activeAssetKeys,
    invalidatedEventKeys,
  });
};

const mergeDividendAssetRegistry = (previousRegistry = [], nextRegistry = [], assets = []) => {
  const getRegistryKey = (entry = {}) => (
    String(entry.ticker || '').trim().toUpperCase()
    || (entry.assetId !== undefined && entry.assetId !== null ? `id:${entry.assetId}` : '')
    || String(entry.name || '').trim().toUpperCase()
  );
  const activeAssetKeys = new Set(assets.map(getRegistryKey).filter(Boolean));
  const registryByKey = new Map();

  previousRegistry
    .filter((entry) => activeAssetKeys.has(getRegistryKey(entry)))
    .forEach((entry) => {
      const key = getRegistryKey(entry);
      const existing = registryByKey.get(key);
      const existingVersion = Number(existing?.refreshVersion) || 0;
      const entryVersion = Number(entry.refreshVersion) || 0;
      const existingCheckedAt = new Date(existing?.checkedAt || 0).getTime() || 0;
      const entryCheckedAt = new Date(entry.checkedAt || 0).getTime() || 0;
      if (
        !existing
        || entryVersion > existingVersion
        || (entryVersion === existingVersion && entryCheckedAt >= existingCheckedAt)
      ) {
        registryByKey.set(key, { ...existing, ...entry });
      }
    });

  nextRegistry.forEach((entry) => {
    const key = getRegistryKey(entry);
    if (!key) return;
    const previous = registryByKey.get(key);
    registryByKey.set(key, {
      ...previous,
      ...entry,
      hasDividends: Boolean(previous?.hasDividends || entry.hasDividends),
      sourceDividendCount: Math.max(
        Number(previous?.sourceDividendCount) || 0,
        Number(entry.sourceDividendCount) || 0,
      ),
      earnedDividendCount: Math.max(
        Number(previous?.earnedDividendCount) || 0,
        Number(entry.earnedDividendCount) || 0,
      ),
    });
  });

  return [...registryByKey.values()].sort((a, b) => getRegistryKey(a).localeCompare(getRegistryKey(b)));
};

const isTradeLinkedToLedger = (trade, ledger = []) => ledger.some((entry) => (
  getTradeSide(entry) === 'sell'
  && trade.name === entry.name
  && (!trade.ticker || !entry.ticker || String(trade.ticker).toUpperCase() === String(entry.ticker).toUpperCase())
  && trade.sellDate === getRecordDate(entry)
  && numbersMatch(trade.quantity, entry.quantity)
  && numbersMatch(trade.sellPrice, entry.price)
));

/**
 * targetPortfolio.items / groups는 분류 id를 키로 갖는 맵이다.
 * Firestore를 merge:true로 쓰면 삭제된 키가 원격에 남으므로,
 * 읽고 쓸 때마다 categories에 없는 키를 걸러 유령 분류가 되살아나지 않게 한다.
 */
const pruneTargetPortfolio = (targetPortfolio) => {
  if (!targetPortfolio) return DEFAULT_TARGET_PORTFOLIO;

  const categories = (Array.isArray(targetPortfolio.categories) ? targetPortfolio.categories : [])
    .filter((category) => isPortfolioAssetCategory(category?.id));
  const validIds = new Set(categories.map((category) => category.id));
  const pickValid = (map = {}) => Object.fromEntries(
    Object.entries(map || {}).filter(([key]) => validIds.has(key)),
  );

  return {
    ...targetPortfolio,
    categories,
    items: pickValid(targetPortfolio.items),
    groups: pickValid(targetPortfolio.groups),
  };
};

const compactPortfolioSnapshot = (snapshot = {}) => {
  const tradeLedger = mergeUniqueRecords(Array.isArray(snapshot.tradeLedger) ? snapshot.tradeLedger : []);
  const rawTrades = mergeUniqueRecords(Array.isArray(snapshot.trades) ? snapshot.trades : []);
  const trades = tradeLedger.length > 0
    ? rawTrades.filter((trade) => isTradeLinkedToLedger(trade, tradeLedger))
    : rawTrades;
  const assets = migrateUserConfirmedAccountTypes(
    mergeUniqueAssets(Array.isArray(snapshot.assets) ? snapshot.assets : []),
  );
  return {
    ...snapshot,
    assets,
    trades,
    memos: mergeUniqueRecords(Array.isArray(snapshot.memos) ? snapshot.memos : []),
    tradeLedger,
    autoDividends: mergeUniqueDividends(Array.isArray(snapshot.autoDividends) ? snapshot.autoDividends : []),
    confirmedDividends: normalizeDividendValidationRecords(
      mergeUniqueDividends(Array.isArray(snapshot.confirmedDividends) ? snapshot.confirmedDividends : []),
    ),
    dividendAssetRegistry: mergeDividendAssetRegistry(Array.isArray(snapshot.dividendAssetRegistry) ? snapshot.dividendAssetRegistry : [], [], assets),
    capitalFlows: mergeUniqueRecords(Array.isArray(snapshot.capitalFlows) ? snapshot.capitalFlows : []),
    portfolioSnapshots: mergeUniqueRecords(Array.isArray(snapshot.portfolioSnapshots) ? snapshot.portfolioSnapshots : []),
    marketCalendarKeywords: normalizeMarketCalendarKeywords(snapshot.marketCalendarKeywords),
    targetPortfolio: pruneTargetPortfolio(snapshot.targetPortfolio),
    portfolioName: normalizePortfolioName(snapshot.portfolioName),
  };
};

const protectPortfolioDividends = (remote, local) => ({
  ...remote,
  autoDividends: mergeAutomaticDividendRecords(remote.autoDividends, local.autoDividends),
  confirmedDividends: mergeDividendRecords(local.confirmedDividends, remote.confirmedDividends),
});

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

/**
 * 원천징수율. 예전에는 두 분기가 모두 0.154를 돌려주는 죽은 조건문이었고,
 * 그 탓에 엔화 배당까지 한국 세율 15.4%로 계산됐다.
 */
const getDividendWithholdingRate = (currency, category = '') => {
  if (currency === 'USD') return 0.15;
  if (currency === 'JPY') return 0.15315; // 일본 원천징수 15.315%
  if (currency === 'KRW' || isDomesticStockCategory(category)) return 0.154;
  return 0.154;
};

const isJapaneseTicker = (ticker = '') => /^\d{4}(\.T)?$/.test(normalizeInputTicker(ticker));

const getTargetItemCurrency = (categoryId, ticker = '', savedCurrency = '') => {
  if (categoryId === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (savedCurrency && savedCurrency !== 'USD') return savedCurrency;
  if (normalizeInputTicker(ticker).includes('.')) return savedCurrency || '';
  return categoryId === '해외주식' ? 'USD' : 'KRW';
};

const getAssetInputCurrency = (category, ticker = '', savedCurrency = '') => {
  if (category === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (category === '해외주식' && normalizeInputTicker(ticker).includes('.') && savedCurrency) return savedCurrency;
  if (category === '해외주식') return 'USD';
  return 'KRW';
};

const isSameAssetRecord = (asset, record) => isRecordForAsset(record, asset);

const getAssetLedgerRows = (asset, ledger = []) => ledger
  .filter((entry) => entry.date && isSameAssetRecord(asset, entry))
  .sort((a, b) => new Date(a.date) - new Date(b.date));

const getDateTimestampSeconds = (date = '') => {
  const rawDate = String(date || '').trim();
  const dateParts = rawDate.match(/\d+/g);
  const normalizedDate = dateParts?.length >= 3
    ? `${dateParts[0].padStart(4, '0')}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`
    : rawDate.replace(/\s*\/\s*/g, '-').replace(/\s+/g, '');
  const timestamp = new Date(`${normalizedDate}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp / 1000 : 0;
};

const getDividendStartDate = (asset, ledger = []) => {
  const firstBuy = getDividendLedgerRows(asset, ledger)
    .filter((entry) => getDividendTradeSide(entry) === 'buy')
    .map((entry) => entry.date)
    .sort()[0];

  const candidates = [firstBuy, asset.buyDate]
    .filter(Boolean)
    .map((date) => ({
      date,
      timestamp: getDateTimestampSeconds(date),
    }))
    .filter((entry) => entry.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  return candidates[0]?.date || firstBuy || asset.buyDate || '';
};

const getAssetBuyLedgerRows = (asset, ledger = []) => getAssetLedgerRows(asset, ledger)
  .filter((entry) => getTradeSide(entry) === 'buy')
  .sort((a, b) => {
    const dateDelta = getDateTimestampSeconds(getRecordDate(a)) - getDateTimestampSeconds(getRecordDate(b));
    if (dateDelta !== 0) return dateDelta;
    return String(a.id || a.sourceId || '').localeCompare(String(b.id || b.sourceId || ''));
  });


const buildAutoDividendRows = ({
  asset,
  ledger = [],
  dividends = {},
  dividendStartDate = '',
  sourceCheckedAt = '',
}) => {
  const buyTimestamp = getDateTimestampSeconds(dividendStartDate || asset.buyDate);
  const dividendEvents = Object.values(dividends || {});
  const currentQuantity = parseNumber(asset.quantity);
  const hasLedgerHistory = getDividendLedgerRows(asset, ledger).length > 0;
  const buildRows = (startTimestamp, useCurrentQuantityFallback = false) => dividendEvents
    .map((d) => {
      const currency = asset.originalCurrency || asset.currency;
      const exDate = new Date(d.date * 1000).toISOString().split('T')[0];
      const eligibilityDate = getDividendEligibilityDate({ exDate, currency });
      if (getDateTimestampSeconds(eligibilityDate) < startTimestamp) return null;
      const heldQuantity = useCurrentQuantityFallback
        ? currentQuantity
        : getDividendHeldQuantityOnDate(asset, ledger, eligibilityDate);
      if (heldQuantity <= 0) return null;

      const withholdingRate = getDividendWithholdingRate(currency, asset.category);
      const accountType = normalizeAccountType(asset.accountType);
      const skipsCalculatedWithholding = isDividendTaxDeferredAccount(accountType);
      const appliesKoreanSmallWithholdingRule = isKoreanDividendSmallWithholdingApplicable({
        currency,
        paymentDate: d.paymentDate,
        exDate,
      });
      const calculation = calculateDividendAmounts({
        perShareGrossAmount: d.amount,
        perShareNetAmount: d.netAmount,
        taxableBasePerShare: d.taxableBasePerShare,
        quantity: heldQuantity,
        withholdingRate,
        sourceAmountIsNet: Boolean(d.sourceAmountIsNet),
        skipCalculatedWithholding: skipsCalculatedWithholding,
        smallWithholdingThreshold: appliesKoreanSmallWithholdingRule
          ? KOREAN_DIVIDEND_SMALL_WITHHOLDING_THRESHOLD
          : 0,
        smallWithholdingIncomeTaxRate: appliesKoreanSmallWithholdingRule
          ? KOREAN_DIVIDEND_INCOME_TAX_RATE
          : 0,
      });

      return {
        id: `${asset.id}-${d.date}`,
        assetId: asset.id,
        date: exDate,
        exDate,
        eligibilityDate,
        recordDate: d.recordDate || '',
        paymentDate: d.paymentDate || '',
        actualPaymentDate: '',
        dateBasis: d.paymentDate ? 'payment' : 'ex-dividend',
        name: asset.name,
        ticker: asset.ticker || '',
        category: asset.category || '',
        round: getTradeRound(asset),
        quantity: calculation.quantity,
        perShareGrossAmount: calculation.perShareGrossAmount,
        perShareNetAmount: calculation.perShareNetAmount,
        grossAmount: calculation.grossAmount,
        taxableAmount: calculation.taxableAmount,
        taxableBasePerShare: d.taxableBasePerShare,
        taxAmount: calculation.taxAmount,
        taxRate: calculation.effectiveTaxRate,
        amount: calculation.amount,
        calculationSource: d.source || 'market-dividend-feed',
        sourceCheckedAt,
        sourceAmountIsNet: Boolean(d.sourceAmountIsNet),
        accountType,
        taxTreatment: skipsCalculatedWithholding
          ? 'tax-deferred-account'
          : calculation.withholdingWaived
            ? 'small-amount-no-withholding'
            : 'withholding-applied',
        entitlementVerified: true,
        currency,
      };
    })
    .filter(Boolean);

  let rows = buildRows(buyTimestamp);
  if (rows.length === 0 && currentQuantity > 0 && !hasLedgerHistory) {
    const assetBuyTimestamp = getDateTimestampSeconds(asset.buyDate);
    rows = buildRows(assetBuyTimestamp || buyTimestamp, true);
  }

  return rows;
};

const createDividendRefreshTask = ({ asset, ledger = [], registry = [], now = '' }) => {
  if (!asset?.ticker || isRemovedAssetCategory(asset.category)) return null;

  const dividendStartDate = getDividendStartDate(asset, ledger);
  if (!dividendStartDate) return null;

  const dividendRefreshState = getDividendRefreshState({
    asset,
    ledger,
    registry,
    now,
  });
  if (!dividendRefreshState.shouldRefresh) return null;

  let dividendTicker = asset.ticker.toUpperCase().trim();
  if (isDomesticStockCategory(asset.category) && !dividendTicker.includes('.')) {
    dividendTicker = `${dividendTicker}.KS`;
  }

  return fetchDividends({
    ...asset,
    ticker: dividendTicker,
  }).then((dividends) => {
    const sourceDividendCount = dividends ? Object.keys(dividends).length : 0;
    if (!dividends) return {
      asset,
      holdingRevision: dividendRefreshState.holdingRevision,
      error: true,
      hasDividends: false,
      sourceDividendCount: 0,
      rows: [],
    };

    const rows = buildAutoDividendRows({
      asset,
      ledger,
      dividends,
      dividendStartDate,
      sourceCheckedAt: now,
    });
    const sourceEventDates = Object.values(dividends).map((dividend) => (
      new Date(dividend.date * 1000).toISOString().split('T')[0]
    ));

    return {
      asset,
      holdingRevision: dividendRefreshState.holdingRevision,
      error: false,
      hasDividends: sourceDividendCount > 0,
      sourceDividendCount,
      sourceEventDates,
      rows,
    };
  }).catch(() => ({
    asset,
    holdingRevision: dividendRefreshState.holdingRevision,
    error: true,
    hasDividends: false,
    sourceDividendCount: 0,
    rows: [],
  }));
};

const getAssetIdentityKey = (asset = {}) => {
  if (asset.id !== undefined && asset.id !== null) return `id:${asset.id}`;
  return [
    normalizeInputTicker(asset.ticker || ''),
    asset.name || '',
    asset.category || '',
  ].join('::');
};

const mergeLiveAssetUpdates = (currentAssets = [], refreshedAssets = []) => {
  const refreshedByKey = new Map(
    refreshedAssets.map((asset) => [getAssetIdentityKey(asset), asset])
  );

  return mergeUniqueAssets(currentAssets.map((asset) => {
    const refreshed = refreshedByKey.get(getAssetIdentityKey(asset));
    if (!refreshed) return asset;

    return {
      ...asset,
      currency: refreshed.currency,
      originalCurrency: refreshed.originalCurrency,
      currentPrice: refreshed.currentPrice,
      originalCurrentPrice: refreshed.originalCurrentPrice,
      quoteStatus: refreshed.quoteStatus,
      quoteSource: refreshed.quoteSource,
      quoteSymbol: refreshed.quoteSymbol,
      quoteCheckedAt: refreshed.quoteCheckedAt,
      quoteUpdatedAt: refreshed.quoteUpdatedAt,
      quoteProviderUpdatedAt: refreshed.quoteProviderUpdatedAt,
      quoteValidation: refreshed.quoteValidation,
      quoteCorroboratedBy: refreshed.quoteCorroboratedBy,
      quoteError: refreshed.quoteError,
    };
  }));
};

const getAssetCategoryOrder = (category = '') => {
  const normalizedCategory = String(category || '').trim();
  if (normalizedCategory === '국내주식') return 10;
  if (normalizedCategory === '해외주식') return 20;
  return 90;
};

/**
 * 가상화폐 기능 제거에 따른 기존 데이터 정리.
 * 자산 목록의 가상화폐 종목명을 기준으로 거래/메모/원장/배당까지 함께 걷어낸다.
 * 자산 목록에 없더라도 카테고리가 '가상화폐'인 기록은 그대로 제거한다.
 */
const purgeCryptoData = (snapshot = {}) => {
  const assets = snapshot.assets || [];
  const cryptoAssets = assets.filter((asset) => isCryptoCategory(asset.category));
  const cryptoNames = new Set(cryptoAssets.map((asset) => asset.name).filter(Boolean));
  const cryptoAssetIds = new Set(
    cryptoAssets
      .map((asset) => (asset.id === undefined || asset.id === null ? '' : String(asset.id)))
      .filter(Boolean),
  );

  const isCryptoRecord = (record = {}) => {
    if (isCryptoCategory(record.category)) return true;
    const recordAssetId = record.assetId === undefined || record.assetId === null ? '' : String(record.assetId);
    if (recordAssetId && cryptoAssetIds.has(recordAssetId)) return true;
    return Boolean(record.name && cryptoNames.has(record.name));
  };

  const keepRecords = (records = []) => records.filter((record) => !isCryptoRecord(record));

  const nextTargetPortfolio = snapshot.targetPortfolio
    ? {
      ...snapshot.targetPortfolio,
      categories: (snapshot.targetPortfolio.categories || []).filter((category) => !isCryptoCategory(category.id)),
      items: Object.fromEntries(
        Object.entries(snapshot.targetPortfolio.items || {}).filter(([key]) => !isCryptoCategory(key)),
      ),
      groups: Object.fromEntries(
        Object.entries(snapshot.targetPortfolio.groups || {}).filter(([key]) => !isCryptoCategory(key)),
      ),
    }
    : snapshot.targetPortfolio;

  const next = {
    ...snapshot,
    assets: assets.filter((asset) => !isCryptoCategory(asset.category)),
    trades: keepRecords(snapshot.trades),
    memos: keepRecords(snapshot.memos),
    tradeLedger: keepRecords(snapshot.tradeLedger),
    autoDividends: keepRecords(snapshot.autoDividends),
    confirmedDividends: keepRecords(snapshot.confirmedDividends),
    dividendAssetRegistry: keepRecords(snapshot.dividendAssetRegistry),
    targetPortfolio: nextTargetPortfolio,
  };

  const removedCount = ['assets', 'trades', 'memos', 'tradeLedger', 'autoDividends', 'confirmedDividends', 'dividendAssetRegistry']
    .reduce((sum, key) => sum + ((snapshot[key] || []).length - (next[key] || []).length), 0);

  return { snapshot: next, removedCount };
};

/**
 * 화면 표시용 환율. 아직 받아오지 못한 통화는 1을 돌려주므로 금액이 실제보다
 * 훨씬 작게 보일 수 있다(첫 동기화 전 또는 환율 조회 실패 시).
 * 세금·손익처럼 틀리면 안 되는 계산에는 쓰지 말고 실측 환율만 쓸 것.
 */
const getCachedKrwRate = (currency, rates = {}, usdRate = 1350, yenRate = 9.5) => {
  if (currency === 'USD') return usdRate || rates.USD || 1350;
  if (currency === 'JPY') return yenRate || rates.JPY || 9.5;
  if (currency && currency !== 'KRW') return rates[currency] || 1;
  return 1;
};

// 이 키가 바뀌면 목표 종목 시세를 다시 가져온다.
// price/nativePrice를 포함하면 effect가 갱신한 값이 다시 effect를 깨워
// 장중 내내 재조회 -> Firestore 쓰기가 반복되므로 구성 정보만 넣는다.
const getTargetItemSnapshotKey = (targetPortfolio) => targetPortfolio.categories
  .flatMap(category => getTargetGroups(targetPortfolio, category.id).flatMap(group => (
    (group.items || []).map(item => `${category.id}:${group.id}:${item.id}:${item.ticker || ''}`)
  )))
  .join('|');

/**
 * 계정 분리 이전 버전이 남긴 비-네임스페이스 키를 현재 저장 영역으로 승계한다.
 *
 * 로그인 계정이면 그대로 가져온다. 비로그인(게스트)일 때는, 예전에 로그인해서 쓴
 * 흔적이 있으면 그 데이터가 다른 사람 것일 수 있으므로 승계하지 않는다.
 * 승계하지 않은 키는 지우지도 않는다 — 원래 주인이 로그인하면 그때 가져간다.
 */
const claimLegacyPortfolioStorage = (scope) => {
  if (!scope) return;

  if (scope === GUEST_STORAGE_SCOPE) {
    const purgedRaw = loadJson(CRYPTO_PURGE_FLAG_KEY, []);
    const signedInFootprint = Array.isArray(purgedRaw)
      && purgedRaw.some((key) => key && key !== 'local');
    if (signedInFootprint) return;
  }

  claimLegacyStorageKeys(PORTFOLIO_STORAGE_KEYS, scope);
};

/** 계정 영역이 확정된 뒤에만 로컬에 기록한다. */
const usePersistedPortfolioSlice = (canPersist, key, value) => {
  useEffect(() => {
    if (!canPersist) return;
    saveJson(key, value);
  }, [canPersist, key, value]);
};

/** 저장 영역 하나를 통째로 읽어온다. 계정이 바뀔 때 상태를 갈아끼우는 데 쓴다. */
const readStoredPortfolio = (scope) => {
  const read = (key, fallback) => loadJson(getScopedStorageKey(key, scope), fallback);

  const stored = {
    portfolioName: normalizePortfolioName(read(PORTFOLIO_NAME_STORAGE_KEY, DEFAULT_PORTFOLIO_NAME)),
    assets: migrateUserConfirmedAccountTypes(read(ASSETS_STORAGE_KEY, [])),
    trades: read(TRADES_STORAGE_KEY, []),
    memos: read(MEMOS_STORAGE_KEY, []),
    tradeLedger: read(TRADE_LEDGER_STORAGE_KEY, []),
    autoDividends: read(AUTO_DIVIDENDS_STORAGE_KEY, []),
    confirmedDividends: read(CONFIRMED_DIVIDENDS_STORAGE_KEY, []),
    dividendAssetRegistry: read(DIVIDEND_ASSET_REGISTRY_STORAGE_KEY, []),
    capitalFlows: read(CAPITAL_FLOWS_STORAGE_KEY, []),
    portfolioSnapshots: read(PORTFOLIO_SNAPSHOTS_STORAGE_KEY, []),
    marketCalendarKeywords: normalizeMarketCalendarKeywords(read(MARKET_CALENDAR_KEYWORDS_STORAGE_KEY, [])),
    targetPortfolio: read(TARGET_PORTFOLIO_STORAGE_KEY, DEFAULT_TARGET_PORTFOLIO),
  };
  const journal = readPortfolioJournal(scope);
  return journal ? { ...stored, ...journal.local } : stored;
};

const App = () => {
  const { user, signOutUser } = useAuth();
  const userId = user?.uid || '';
  const userEmail = user?.email || '';
  // 1. 상태 관리
  const [exchangeRate, setExchangeRate] = useState(0); 
  const [jpyKrwRate, setJpyKrwRate] = useState(0);
  const [currencyRates, setCurrencyRates] = useState({ KRW: 1 });
  const [lastUpdated, setLastUpdated] = useState(null);
  /**
   * 시세 동기화가 "한 번은 끝났다"는 표시. 이게 없으면 화면이 뜬 직후(아직 동기화가
   * 시작되지도 않은 순간)의 저장된 가격·기본 환율로 계산한 값이 그대로 수익률 카드에
   * 들어가, 새로고침할 때마다 다른 숫자가 잠깐씩 보였다가 바뀐다.
   */
  const [activeTab, setActiveTab] = useState('portfolio');
  const [isFetching, setIsFetching] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [assetPendingRemoval, setAssetPendingRemoval] = useState(null);

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
  const addLogRef = useRef(addLog);
  addLogRef.current = addLog;

  // localStorage 저장 실패(용량 초과, 시크릿 모드)를 사용자에게 알린다.
  useEffect(() => {
    setStorageErrorHandler((key, error, operation) => {
      addLogRef.current(
        operation === 'read'
          ? '이 기기에 저장된 데이터 일부를 읽지 못해 기본값으로 시작했습니다.'
          : '브라우저 저장 공간이 부족해 로컬 저장에 실패했습니다.',
        'error',
      );
    });
    return () => setStorageErrorHandler(null);
  }, []);

  // 삭제 확인 모달은 Escape로 닫을 수 있어야 한다.
  useEffect(() => {
    if (!assetPendingRemoval) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAssetPendingRemoval(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assetPendingRemoval]);

  const [selectedCategory, setSelectedCategory] = useState(null);
  // 자산 ID별 표시 통화. 'KRW'면 원화 환산, 그 외에는 현지 통화로 보여준다.
  const [assetCurrencyView, setAssetCurrencyView] = useState({});
  const [selectedDividendAsset, setSelectedDividendAsset] = useState(null);
  const [dividendFilter, setDividendFilter] = useState('전체');
  const [calendarMonth, setCalendarMonth] = useState(() => formatKoreanDate().slice(0, 7));
  const [calendarView, setCalendarView] = useState('dividend');
  const annualDividendYear = Number(calendarMonth.slice(0, 4));
  const [annualDividendFxRates, setAnnualDividendFxRates] = useState(() => (
    loadJson(ANNUAL_DIVIDEND_FX_RATES_STORAGE_KEY, {})
  ));
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState('');
  const [expandedCalendarDate, setExpandedCalendarDate] = useState('');
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  // AI 요약 모달이 보고 있는 종목. null이면 닫힘.
  const [insightAsset, setInsightAsset] = useState(null);
  const { theme, toggleTheme } = useTheme();
  const [annualReturnYear, setAnnualReturnYear] = useState(() => new Date().getFullYear());

  const [isAdding, setIsAdding] = useState(false);
  const defaultBuyDate = formatKoreanDate();
  const [isAddingDividend, setIsAddingDividend] = useState(false);
  const dividendImportInputRef = useRef(null);
  const [actualDividendForm, setActualDividendForm] = useState({
    assetId: '',
    name: '',
    ticker: '',
    category: '국내주식',
    date: defaultBuyDate,
    amount: '',
    quantity: '',
    currency: 'KRW',
  });
  const [tradeSortMode, setTradeSortMode] = useState('newest');
  const [tradeStockFilter, setTradeStockFilter] = useState('all');
  const [tradeSideFilter, setTradeSideFilter] = useState('all');
  const [tradeVisibleCount, setTradeVisibleCount] = useState(TRADE_PAGE_SIZE);
  const [expandedTradeMemoId, setExpandedTradeMemoId] = useState('');
  const [isManualTradeEntryOpen, setIsManualTradeEntryOpen] = useState(false);
  const [performanceSearchTerm, setPerformanceSearchTerm] = useState('');
  const [targetViewMode, setTargetViewMode] = useState('table');
  const [selectedTargetCategory, setSelectedTargetCategory] = useState(null);
  const [selectedTargetGroup, setSelectedTargetGroup] = useState(null);
  const [targetPriceSyncStatus, setTargetPriceSyncStatus] = useState('');
  const [targetCategoryDraft, setTargetCategoryDraft] = useState('국내주식');
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
  memo: '',
  accountType: ACCOUNT_TYPE_GENERAL,
  brokerId: DEFAULT_BROKER_ID,
  brokerFeeRate: '0',
  // 매수 수수료도 매도처럼 증권사 화면에 찍힌 금액을 그대로 받는다(요율 % 입력은 두지 않는다).
  // 금액을 비워 두면 선택한 증권사의 기본 요율로 계산한다.
  feeMode: 'amount',
  brokerFeeAmount: '',
  // 해외 종목의 단가를 어떤 통화로 입력할지. 'NATIVE'는 달러/엔, 'KRW'는 원화.
  priceInputCurrency: 'NATIVE',
};
  const [newAsset, setNewAsset] = useState(initialAssetState);
const initialAddBuyState = {
  quantity: '',
  averagePrice: '',
  buyDate: defaultBuyDate,
  memo: '',
  priceInputCurrency: 'NATIVE',
  brokerId: DEFAULT_BROKER_ID,
  brokerFeeRate: '0',
  feeMode: 'amount',
  brokerFeeAmount: '',
};

const [addBuyForm, setAddBuyForm] = useState(initialAddBuyState);

// 원화로 단가를 입력할 때 쓰는 "매수일 환율" 캐시. key는 `통화::날짜`.
// status: 'loading' | 'ready' | 'error'
const [buyDateFxRates, setBuyDateFxRates] = useState({});
const buyDateFxRatesRef = useRef(buyDateFxRates);
useEffect(() => { buyDateFxRatesRef.current = buyDateFxRates; }, [buyDateFxRates]);

const [isSellingAsset, setIsSellingAsset] = useState(false);
const [selectedAssetToSell, setSelectedAssetToSell] = useState(null);
const [selectedAssetToManageBuys, setSelectedAssetToManageBuys] = useState(null);
const [buyLotDrafts, setBuyLotDrafts] = useState([]);
const [accountTypeDraft, setAccountTypeDraft] = useState(ACCOUNT_TYPE_GENERAL);
// 증권사 앱의 '투자 원금'을 그대로 넣어 맞추고 싶을 때 쓰는 수동 입력값.
const [manualPurchaseKrwDraft, setManualPurchaseKrwDraft] = useState('');

const initialSellFormState = {
  sellPrice: '',
  quantity: '',
  sellDate: defaultBuyDate,
  brokerId: DEFAULT_BROKER_ID,
  brokerFeeRate: '0',
  // 매도 수수료는 증권사 화면에 찍힌 금액을 그대로 받는다(요율 입력은 두지 않는다).
  feeMode: 'amount',
  brokerFeeAmount: '',
  sellTaxRate: '0',
  memo: ''
};

const [sellForm, setSellForm] = useState(initialSellFormState);
const sellFeePreview = useMemo(() => {
  if (!selectedAssetToSell) return null;

  const quantity = parseNumber(sellForm.quantity);
  const sellPrice = parseNumber(sellForm.sellPrice);
  const buyPrice = parseNumber(selectedAssetToSell.originalAveragePrice || selectedAssetToSell.averagePrice);
  const feeRatePercent = parseNumber(sellForm.brokerFeeRate);
  const sellTaxRatePercent = parseNumber(sellForm.sellTaxRate);

  return calculateSellCosts({
    brokerFeeAmount: sellForm.feeMode === 'amount' ? sellForm.brokerFeeAmount : null,
    category: selectedAssetToSell.category,
    currency: selectedAssetToSell.currency,
    quantity,
    sellPrice,
    buyPrice,
    brokerFeeRatePercent: feeRatePercent,
    sellTaxRatePercent,
  });
}, [selectedAssetToSell, sellForm]);
/**
 * 매수 수수료(현지 통화). 원화로 단가를 입력한 경우에도 최종적으로는 현지 통화
 * 매수금액에 요율을 곱한 값이라 결과가 같다.
 *
 * feeKrwRate: 해외 종목 단가를 원화로 입력하면 수수료 칸도 원화(₩)로 보인다.
 * 그 금액을 그대로 달러로 저장하면 1,500원이 $1,500이 되므로 매수일 환율로 되돌린다.
 */
const calculateBuyFee = (form = {}, quantity, price, currency = 'KRW', { feeKrwRate = 0 } = {}) => {
  // 금액을 직접 넣었으면 그것이 실제로 낸 돈이다. 요율보다 우선한다.
  // 다만 금액 칸이 비어 있으면 증권사 기본 요율 계산을 그대로 쓴다.
  if (form.feeMode === 'amount') {
    const known = resolveKnownFeeAmount(form.brokerFeeAmount);
    if (known !== null) return roundTradeCost(feeKrwRate > 0 ? known / feeKrwRate : known, currency);
  }
  const amount = Math.max(0, parseNumber(quantity)) * Math.max(0, parseNumber(price));
  const rate = Math.max(0, parseNumber(form.brokerFeeRate)) / 100;
  return roundTradeCost(amount * rate, currency);
};

// 원화로 단가를 입력 중이면 그 금액도 원화라 원 단위로 절사한다.
const newAssetFeeCurrency = newAsset.priceInputCurrency === 'KRW' ? 'KRW' : newAsset.currency;
const newAssetBuyFeePreview = useMemo(() => calculateBuyFee(
  newAsset, newAsset.quantity, newAsset.averagePrice, newAssetFeeCurrency,
), [newAsset, newAssetFeeCurrency]);

const addBuyFeeCurrency = addBuyForm.priceInputCurrency === 'KRW'
  ? 'KRW'
  : (selectedAssetToUpdate?.currency || 'KRW');
const addBuyFeePreview = useMemo(() => calculateBuyFee(
  addBuyForm, addBuyForm.quantity, addBuyForm.averagePrice, addBuyFeeCurrency,
), [addBuyForm, addBuyFeeCurrency]);

const managedAssetCurrency = selectedAssetToManageBuys?.currency || 'KRW';
const buyLotDraftSummary = useMemo(() => {
  const totalQuantity = buyLotDrafts.reduce((sum, lot) => sum + parseNumber(lot.quantity), 0);
  const totalCost = buyLotDrafts.reduce((sum, lot) => (
    sum + parseNumber(lot.quantity) * parseNumber(lot.price)
  ), 0);
  const totalBuyFee = buyLotDrafts.reduce((sum, lot) => (
    sum + roundTradeCost(parseNumber(lot.brokerFee), managedAssetCurrency)
  ), 0);

  return {
    totalQuantity,
    averagePrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
    totalBuyFee,
  };
}, [buyLotDrafts, managedAssetCurrency]);

  /**
   * 국내/해외는 수수료율이 다르므로 카테고리를 바꾸면 증권사 기본 요율로 다시 채운다.
   * 이 요율은 수수료 금액 칸을 비워 뒀을 때만 쓰인다. '직접 입력'은 기본 요율이 없어 건드리지 않는다.
   */
  useEffect(() => {
    if (!isAdding) return;
    setNewAsset((prev) => {
      if (prev.brokerId === 'custom') return prev;
      const nextRate = formatFeeRateInput(getBrokerFeeRatePercent(prev.brokerId, prev.category));
      return prev.brokerFeeRate === nextRate ? prev : { ...prev, brokerFeeRate: nextRate };
    });
  }, [isAdding, newAsset.brokerId, newAsset.category]);

  useEffect(() => {
    const nextCurrency = getAssetInputCurrency(newAsset.category, newAsset.ticker);
    if (nextCurrency === 'USD') {
      setNewAsset(prev => ({ ...prev, currency: 'USD' }));
    } else if (nextCurrency === 'JPY') {
      setNewAsset(prev => ({ ...prev, currency: 'JPY' }));
    } else {
      setNewAsset(prev => ({ ...prev, currency: 'KRW' }));
    }
  }, [newAsset.category, newAsset.ticker]);

  // 로컬 저장 키는 반드시 계정별로 분리한다. AuthGate가 인증 확인이 끝난 뒤에만
  // App을 렌더하므로, 아래 useState 초기화 시점에 이미 userId가 확정돼 있다.
  const storageScope = userId || GUEST_STORAGE_SCOPE;
  const scopedKey = useCallback(
    (key) => getScopedStorageKey(key, storageScope),
    [storageScope],
  );

  // 계정 분리 이전 버전에서 저장된 데이터를 현재 계정 영역으로 승계한다.
  // 훅은 선언 순서대로 실행되므로, 아래 상태 초기화보다 반드시 먼저 놓아야 한다.
  useMemo(() => {
    claimLegacyPortfolioStorage(storageScope);
  }, [storageScope]);

  const initialPortfolio = useMemo(() => readStoredPortfolio(storageScope), [storageScope]);
  const [assets, setAssets] = useState(() => (
    migrateUserConfirmedAccountTypes(initialPortfolio.assets)
  ));
  const [trades, setTrades] = useState(() => initialPortfolio.trades);
  const [memos, setMemos] = useState(() => initialPortfolio.memos);
  const [tradeLedger, setTradeLedger] = useState(() => initialPortfolio.tradeLedger);

  /**
   * 이번 매도 수량에 배분되는 매수 수수료(현지 통화). 이동평균으로 비례 배분한다.
   * tradeLedger를 읽으므로 반드시 그 선언 뒤에 있어야 한다(렌더 중 TDZ 오류 방지).
   * 회차까지 같은 행만 봐야 매도 후 재매수한 물량의 수수료가 섞이지 않는다.
   */
  const getSellBuyFeeShare = (asset, sellQuantity) => {
    if (!asset) return 0;
    const assetKey = getTradeAssetKey(asset);
    const rows = tradeLedger.filter((entry) => getTradeAssetKey(entry) === assetKey);
    const position = buildPositionFromTradeRows(rows);
    if (!(position.quantity > 0) || !(position.buyFeeCost > 0)) return 0;
    const ratio = Math.min(1, Math.max(0, parseNumber(sellQuantity) / position.quantity));
    return position.buyFeeCost * ratio;
  };

  const sellBuyFeeShare = useMemo(() => (
    getSellBuyFeeShare(selectedAssetToSell, sellForm.quantity)
    // getSellBuyFeeShare는 매 렌더 새로 만들어지므로 의존성에 넣으면 메모가 무의미해진다.
    // 실제로 값을 바꾸는 입력은 아래 셋뿐이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [selectedAssetToSell, sellForm.quantity, tradeLedger]);
  const [portfolioName, setPortfolioName] = useState(() => normalizePortfolioName(initialPortfolio.portfolioName));
  const [targetPortfolio, setTargetPortfolio] = useState(() => initialPortfolio.targetPortfolio);
  const [capitalFlows, setCapitalFlows] = useState(() => initialPortfolio.capitalFlows);
  const [portfolioSnapshots, setPortfolioSnapshots] = useState(() => initialPortfolio.portfolioSnapshots);
  const [dividendAssetRegistry, setDividendAssetRegistry] = useState(() => initialPortfolio.dividendAssetRegistry);
  const [marketCalendarKeywords, setMarketCalendarKeywords] = useState(() => (
    normalizeMarketCalendarKeywords(initialPortfolio.marketCalendarKeywords)
  ));
  // 매수·매도 모달이 공유하는 기본 증권사. 매번 고르지 않아도 되게 기억해 둔다.
  const [preferredBrokerId, setPreferredBrokerId] = useState(() => (
    getBrokerPreset(loadJson(scopedKey(PREFERRED_BROKER_STORAGE_KEY), DEFAULT_BROKER_ID)).id
  ));
  const targetPortfolioRef = useRef(targetPortfolio);
  const targetTickerSnapshotKey = useMemo(() => (
    getTargetItemSnapshotKey(targetPortfolio)
  ), [targetPortfolio]);

  const [autoDividends, setAutoDividends] = useState(() => initialPortfolio.autoDividends);
  const [confirmedDividends, setConfirmedDividends] = useState(() => initialPortfolio.confirmedDividends);
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
    capitalFlows,
    portfolioSnapshots,
    marketCalendarKeywords,
    targetPortfolio,
  }), [portfolioName, assets, trades, memos, tradeLedger, autoDividends, confirmedDividends, dividendAssetRegistry, capitalFlows, portfolioSnapshots, marketCalendarKeywords, targetPortfolio]);
  const portfolioSnapshotRef = useRef(portfolioSnapshot);

  // 계정이 바뀐 직후에는 화면 상태가 아직 이전 계정 것이다. 그대로 저장하면
  // 새 계정 영역에 남의 데이터가 기록되므로, 영역 전환이 끝날 때까지 저장을 멈춘다.
  const [persistedStorageScope, setPersistedStorageScope] = useState(storageScope);
  const isStorageScopeReady = persistedStorageScope === storageScope;

  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(ASSETS_STORAGE_KEY), assets);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(TRADES_STORAGE_KEY), trades);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(MEMOS_STORAGE_KEY), memos);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(TRADE_LEDGER_STORAGE_KEY), tradeLedger);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(AUTO_DIVIDENDS_STORAGE_KEY), autoDividends);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(CONFIRMED_DIVIDENDS_STORAGE_KEY), confirmedDividends);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(DIVIDEND_ASSET_REGISTRY_STORAGE_KEY), dividendAssetRegistry);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(CAPITAL_FLOWS_STORAGE_KEY), capitalFlows);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(PORTFOLIO_SNAPSHOTS_STORAGE_KEY), portfolioSnapshots);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(MARKET_CALENDAR_KEYWORDS_STORAGE_KEY), marketCalendarKeywords);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(PORTFOLIO_NAME_STORAGE_KEY), portfolioName);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(TARGET_PORTFOLIO_STORAGE_KEY), targetPortfolio);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(PREFERRED_BROKER_STORAGE_KEY), preferredBrokerId);
  useEffect(() => { targetPortfolioRef.current = targetPortfolio; }, [targetPortfolio]);
  useEffect(() => { portfolioSnapshotRef.current = portfolioSnapshot; }, [portfolioSnapshot]);

  const applyStoredPortfolio = useCallback((stored) => {
    setAssets(stored.assets);
    setTrades(stored.trades);
    setMemos(stored.memos);
    setTradeLedger(stored.tradeLedger);
    setAutoDividends(stored.autoDividends);
    setConfirmedDividends(stored.confirmedDividends);
    setDividendAssetRegistry(stored.dividendAssetRegistry);
    setCapitalFlows(stored.capitalFlows);
    setPortfolioSnapshots(stored.portfolioSnapshots);
    setMarketCalendarKeywords(stored.marketCalendarKeywords);
    setPortfolioName(stored.portfolioName);
    setTargetPortfolio(stored.targetPortfolio);
  }, []);

  const notifyPortfolioSync = useCallback((...args) => addLogRef.current(...args), []);
  const cloudSync = usePortfolioCloudSync({
    database: db, user, snapshot: portfolioSnapshot, ready: isStorageScopeReady,
    compact: compactPortfolioSnapshot, protect: protectPortfolioDividends,
    onApply: applyStoredPortfolio, onLog: notifyPortfolioSync,
  });
  const isCloudPortfolioLoaded = cloudSync.loaded;
  const cloudLoadFailed = cloudSync.failed;
  const cloudPortfolioUserId = cloudSync.userId;

  // 로그인/로그아웃/계정 전환으로 저장 영역이 바뀌면, 화면 상태를 새 영역의
  // 저장값으로 통째로 갈아끼운다. 이전 계정 상태가 새 영역으로 흘러가지 않는다.
  useEffect(() => {
    if (persistedStorageScope === storageScope) return;

    claimLegacyPortfolioStorage(storageScope);

    /**
     * 이 세션에서 비로그인으로 쓰다가 방금 로그인했다면, 그 기록은 지금 로그인한
     * 본인의 것이다. 새 계정 영역이 비어 있을 때만 옮긴다.
     * (페이지를 새로 연 뒤의 로그인은 이 경로를 타지 않는다. 그때의 게스트 데이터는
     *  다른 사람이 남긴 것일 수 있어 계정으로 끌어오지 않는다.)
     */
    if (persistedStorageScope === GUEST_STORAGE_SCOPE && storageScope !== GUEST_STORAGE_SCOPE) {
      const hasAccountData = PORTFOLIO_STORAGE_KEYS
        .some((key) => hasStoredKey(getScopedStorageKey(key, storageScope)));
      if (!hasAccountData) {
        const moved = moveStorageScope(PORTFOLIO_STORAGE_KEYS, GUEST_STORAGE_SCOPE, storageScope);
        if (moved > 0) addLogRef.current('로그인 전에 입력한 기록을 계정으로 옮겼습니다.', 'success');
      }
    }

    applyStoredPortfolio(readStoredPortfolio(storageScope));
    setPersistedStorageScope(storageScope);
  }, [storageScope, persistedStorageScope, applyStoredPortfolio]);

  const handleSignOut = async () => {
    try {
      // Account-scoped caches and the durable journal survive sign-out. Guest
      // mode uses a separate namespace and cannot display these records.
      await signOutUser();
    } catch (error) {
      console.error('Sign out failed:', error);
      addLog('로그아웃 처리 중 오류가 발생했습니다.', 'error');
    }
  };

  // 가상화폐 기능 제거에 따른 1회성 데이터 정리.
  // 클라우드 로드가 '성공'한 뒤에 돌려야 원격 데이터까지 함께 정리된다.
  // 로드 실패 상태에서 플래그를 남기면 원격의 가상화폐 데이터가 영영 정리되지 않는다.
  const cryptoPurgedKeyRef = useRef('');
  useEffect(() => {
    if (!isCloudPortfolioLoaded || cloudLoadFailed) return;
    if (userId && cloudPortfolioUserId !== userId) return;

    const purgeKey = userId || 'local';
    if (cryptoPurgedKeyRef.current === purgeKey) return;

    const purgedRaw = loadJson(CRYPTO_PURGE_FLAG_KEY, []);
    const purgedKeys = Array.isArray(purgedRaw) ? purgedRaw : [];
    cryptoPurgedKeyRef.current = purgeKey;
    if (purgedKeys.includes(purgeKey)) return;

    const { snapshot: purged, removedCount } = purgeCryptoData(portfolioSnapshotRef.current || {});
    saveJson(CRYPTO_PURGE_FLAG_KEY, [...purgedKeys, purgeKey]);

    if (removedCount <= 0) return;

    setAssets(purged.assets);
    setTrades(purged.trades);
    setMemos(purged.memos);
    setTradeLedger(purged.tradeLedger);
    setAutoDividends(purged.autoDividends);
    setConfirmedDividends(purged.confirmedDividends);
    setDividendAssetRegistry(purged.dividendAssetRegistry);
    setTargetPortfolio(purged.targetPortfolio);
    addLog(`가상화폐 관련 기록 ${removedCount.toLocaleString()}건을 정리했습니다.`, 'success');
  }, [isCloudPortfolioLoaded, cloudLoadFailed, cloudPortfolioUserId, userId]);

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
    setAssets(prevAssets => {
      const mergedAssets = mergeUniqueAssets(prevAssets);
      const reconciledAssets = recoverMissingAssetsFromTradeLedger(mergedAssets, tradeLedger);

      // 원장상 전량 매도된 종목은 목록에서 빠지는 게 정상이다. 예전에는 '개수가 줄면
      // 통째로 버리기'로 막았는데, 그러면 한 종목만 청산돼도 나머지 종목의 수량·평단
      // 보정까지 전부 사라졌다. 지금은 보정 결과를 유지하되, 원장이 깨져서 대량으로
      // 사라지는 경우(절반 초과)만 방어한다.
      const removedCount = mergedAssets.length - reconciledAssets.length;
      const isImplausibleRemoval = mergedAssets.length > 1
        && removedCount > Math.floor(mergedAssets.length / 2);

      return isImplausibleRemoval ? mergedAssets : reconciledAssets;
    });
  }, [isCloudPortfolioLoaded, tradeLedger]);

  // 2. 완벽한 데이터 연동 로직
  const assetsRef = useRef(assets);
  const tradeLedgerRef = useRef(tradeLedger);
  const dividendAssetRegistryRef = useRef(dividendAssetRegistry);
  const exchangeRateRef = useRef(exchangeRate);
  const jpyKrwRateRef = useRef(jpyKrwRate);
  const currencyRatesRef = useRef(currencyRates);
  // 시세 갱신은 겹쳐 돌면 안 되지만, 겹쳤다고 그냥 버려서도 안 된다.
  // 실행을 직렬로 이어 붙여 마지막 요청이 반드시 한 번은 돌게 한다.
  const liveFetchChainRef = useRef(Promise.resolve());
  const liveFetchRunIdRef = useRef(0);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => { tradeLedgerRef.current = tradeLedger; }, [tradeLedger]);
  useEffect(() => { dividendAssetRegistryRef.current = dividendAssetRegistry; }, [dividendAssetRegistry]);
  useEffect(() => { exchangeRateRef.current = exchangeRate; }, [exchangeRate]);
  useEffect(() => { jpyKrwRateRef.current = jpyKrwRate; }, [jpyKrwRate]);
  useEffect(() => { currencyRatesRef.current = currencyRates; }, [currencyRates]);

  useEffect(() => {
    if (!isCloudPortfolioLoaded) return undefined;
    let cancelled = false;

    let queuedRun = false;

    const runLiveSync = async () => {
      const runId = liveFetchRunIdRef.current + 1;
      liveFetchRunIdRef.current = runId;
      const isLatestRun = () => !cancelled && runId === liveFetchRunIdRef.current;

      setIsFetching(true);
      const currentAssets = assetsRef.current;
      const shouldShowSyncLogs = currentAssets.length > 0;
      if (shouldShowSyncLogs) addLog("데이터 연동을 시작합니다...", "info");

      try {
        let currentRate = exchangeRateRef.current;
        let currentJpyRate = jpyKrwRateRef.current;
        const nextCurrencyRates = { ...currencyRatesRef.current, KRW: 1 };
        const getCurrencyRate = async (currency = 'KRW') => {
          const code = String(currency || 'KRW').toUpperCase();
          if (code === 'KRW') return 1;
          if (nextCurrencyRates[code]) return nextCurrencyRates[code];

          const rate = await fetchKrwRate(code);
          if (rate) nextCurrencyRates[code] = rate;
          return nextCurrencyRates[code] || 1;
        };
        
        // [1] 환율 연동
        const [fetchedRate, fetchedJpyRate] = await Promise.all([
          fetchUsdKrwRate(),
          fetchKrwRate('JPY'),
        ]);

        if (fetchedRate) {
          currentRate = fetchedRate;
          if (shouldShowSyncLogs) addLog(`환율 연동 완료: 1$ = ${currentRate.toLocaleString(undefined, {maximumFractionDigits:2})}원`, "success");
        } else {
          if (shouldShowSyncLogs) addLog("환율 서버 응답 지연", "error");
        }
        if (currentRate > 0) setExchangeRate(currentRate);
        if (currentRate > 0) nextCurrencyRates.USD = currentRate;

        if (fetchedJpyRate) currentJpyRate = fetchedJpyRate;
        if (currentJpyRate > 0) setJpyKrwRate(currentJpyRate);
        if (currentJpyRate > 0) nextCurrencyRates.JPY = currentJpyRate;

        const currentTradeLedger = tradeLedgerRef.current;
        const currentDividendRegistry = dividendAssetRegistryRef.current;
        const dividendCalculationAssets = buildDividendCalculationAssets(currentAssets, currentTradeLedger);
        const dividendTasks = [];
        const quoteStatuses = [];
        const quoteCheckedAt = new Date().toISOString();
        const tradingViewQuotes = await fetchTradingViewQuotes(currentAssets);

        const updatedAssets = await Promise.all(currentAssets.map(async (asset, assetIndex) => {
          let newCurrentPrice = asset.currentPrice;
          let newOriginalCurrentPrice = asset.originalCurrentPrice || asset.originalAveragePrice;
          let nextAssetCurrency = asset.currency;
          let quoteMetadata = {};
          
          // 없앤 현금·원자재 분류로 남아 있는 옛 기록은 시세를 받지 않는다.
          if (asset.ticker && !isRemovedAssetCategory(asset.category)) {
            let stockQuote = tradingViewQuotes[assetIndex] || null;
            if (!stockQuote) {
              try {
                stockQuote = await fetchStockQuote(asset);
              } catch {
                stockQuote = null;
              }
            }

            const quoteCurrency = stockQuote?.currency
              || asset.currency
              || asset.originalCurrency
              || 'KRW';
            const quoteRate = await getCurrencyRate(quoteCurrency);
            const quoteResult = buildLivePriceUpdate({
              asset,
              quote: stockQuote,
              rate: quoteRate,
              checkedAt: quoteCheckedAt,
            });

            quoteStatuses.push(quoteResult.status);
            newCurrentPrice = quoteResult.asset.currentPrice;
            newOriginalCurrentPrice = quoteResult.asset.originalCurrentPrice;
            nextAssetCurrency = quoteResult.asset.currency;
            quoteMetadata = {
              quoteStatus: quoteResult.asset.quoteStatus,
              quoteSource: quoteResult.asset.quoteSource,
              quoteSymbol: quoteResult.asset.quoteSymbol,
              quoteCheckedAt: quoteResult.asset.quoteCheckedAt,
              quoteUpdatedAt: quoteResult.asset.quoteUpdatedAt,
              quoteProviderUpdatedAt: quoteResult.asset.quoteProviderUpdatedAt,
              quoteValidation: quoteResult.asset.quoteValidation,
              quoteCorroboratedBy: quoteResult.asset.quoteCorroboratedBy,
              quoteError: quoteResult.asset.quoteError,
            };

            if (quoteResult.status === 'failed') {
              addLog(`[${asset.name}] 주가 연동 실패 (티커 재확인)`, "error");
            } else if (quoteResult.status === 'rejected') {
              addLog(`[${asset.name}] 비정상 시세 응답을 차단했습니다.`, "error");
            }

          }
          return {
            ...asset,
            currency: nextAssetCurrency,
            originalCurrency: nextAssetCurrency,
            currentPrice: newCurrentPrice,
            originalCurrentPrice: newOriginalCurrentPrice,
            ...quoteMetadata,
          };
        }));

        dividendCalculationAssets.forEach((asset) => {
          const task = createDividendRefreshTask({
            asset,
            ledger: currentTradeLedger,
            registry: currentDividendRegistry,
            now: quoteCheckedAt,
          });
          if (task) dividendTasks.push(task);
        });

        if (!isLatestRun()) return;

        setCurrencyRates(prev => {
          const changed = Object.entries(nextCurrencyRates).some(([currency, rate]) => prev[currency] !== rate);
          return changed ? nextCurrencyRates : prev;
        });
        setAssets(prevAssets => mergeLiveAssetUpdates(prevAssets, updatedAssets));
        const priceSyncSummary = summarizePriceSync(quoteStatuses);
        const checkedQuoteCount = quoteStatuses.length;
        if (priceSyncSummary.live > 0) setLastUpdated(new Date().toLocaleTimeString());

        if (checkedQuoteCount > 0 && priceSyncSummary.live === checkedQuoteCount) {
          addLog(`현재가 ${priceSyncSummary.live.toLocaleString()}건 조회 완료`, "success");
        } else if (checkedQuoteCount > 0) {
          const unavailableCount = priceSyncSummary.failed + priceSyncSummary.rejected;
          addLog(
            `현재가 조회 ${priceSyncSummary.live.toLocaleString()}건 성공 · 저장 가격 ${priceSyncSummary.cached.toLocaleString()}건${unavailableCount > 0 ? ` · 실패 ${unavailableCount.toLocaleString()}건` : ''}`,
            "error",
          );
        }

        if (dividendTasks.length > 0) {
          Promise.all(dividendTasks).then((dividendResults) => {
            if (!isLatestRun()) return;

            const successfulResults = dividendResults.filter((result) => !result.error);
            const nextAutoDividends = successfulResults
              .flatMap((result) => result.rows)
              .sort((a, b) => new Date(b.date) - new Date(a.date));
            const refreshedSourceEventKeys = successfulResults.flatMap((result) => (
              (result.sourceEventDates || []).map((date) => getAutomaticDividendEventKey({
                ticker: result.asset.ticker,
                name: result.asset.name,
                round: getTradeRound(result.asset),
                date,
              }))
            ));

            const registryCheckedAt = new Date().toISOString();
            const nextRegistry = dividendResults.map((result) => ({
              assetId: result.asset.id,
              name: result.asset.name,
              ticker: result.asset.ticker,
              category: result.asset.category,
              currency: result.asset.currency,
              hasDividends: result.hasDividends,
              sourceDividendCount: result.sourceDividendCount,
              earnedDividendCount: result.rows.length,
              holdingRevision: result.holdingRevision,
              refreshVersion: getDividendRefreshVersion(result.asset),
              dateBasis: result.rows.some((row) => row.paymentDate) ? 'payment' : 'ex-dividend',
              syncStatus: result.error ? 'error' : 'success',
              checkedAt: registryCheckedAt,
            }));

            setDividendAssetRegistry(prevRegistry => (
              mergeDividendAssetRegistry(prevRegistry, nextRegistry, dividendCalculationAssets)
            ));

            setAutoDividends(prevDividends => (
              successfulResults.length > 0
                ? mergeDividendResultsByAsset(
                  prevDividends,
                  nextAutoDividends,
                  dividendCalculationAssets,
                  refreshedSourceEventKeys,
                )
                : prevDividends.filter((dividend) => (
                  dividendCalculationAssets.some((asset) => (
                    getDividendAssetKey(asset) === getDividendAssetKey(dividend)
                  ))
                ))
            ));
          });
        } else {
          setAutoDividends(prevDividends => (
            prevDividends.filter((dividend) => (
              dividendCalculationAssets.some((asset) => (
                getDividendAssetKey(asset) === getDividendAssetKey(dividend)
              ))
            ))
          ));
        }

      } catch (e) { 
        console.error("Update error:", e); 
        if (isLatestRun() && assetsRef.current.length > 0) addLog("네트워크 오류로 갱신 실패", "error");
      }
      finally {
        if (runId === liveFetchRunIdRef.current) {
          setIsFetching(false);
        }
      }
    };

    /**
     * 예전에는 실행 중이면 그냥 return 했다. 그래서 동기화 도중 새로고침을 누르면
     * 이전 실행은 cancelled 처리로 결과를 버리고, 새 실행은 "이미 실행 중"이라며
     * 즉시 빠져나가 아무것도 갱신되지 않았다(다음 자동 갱신까지 10분 무반응).
     * 지금은 이전 실행 뒤에 이어 붙여, 요청이 반드시 한 번은 반영되게 한다.
     */
    const fetchLiveData = () => {
      if (queuedRun) return liveFetchChainRef.current;
      queuedRun = true;

      const run = liveFetchChainRef.current
        .catch(() => {})
        .then(() => (cancelled ? undefined : runLiveSync()))
        .finally(() => { queuedRun = false; });

      liveFetchChainRef.current = run;
      return run;
    };

    fetchLiveData();
    let interval;
    interval = setInterval(fetchLiveData, AUTO_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [refreshTrigger, isCloudPortfolioLoaded]);

  const dividendEntryAssets = useMemo(() => (
    buildDividendCalculationAssets(assets, tradeLedger)
      .filter((asset) => !isRemovedAssetCategory(asset.category))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
  ), [assets, tradeLedger]);

  // Photo/imported receipts remain validation-only. Only a receipt explicitly
  // entered by the user can replace its matching formula row in displayed cash.
  const reportedDividends = useMemo(() => (
    selectReportedDividendRecords(
      selectFormulaDividendRecords(autoDividends),
      selectUserEnteredDividendRecords(confirmedDividends),
    )
  ), [autoDividends, confirmedDividends]);
  const receivedDividends = useMemo(() => (
    selectReceivedDividendRecords(reportedDividends)
  ), [reportedDividends]);

  const {
    enhancedAssets,
    portfolioAssets,
    totalConvertedKRW,
    currentChartData,
    subChartData,
    currentCategoryKRW,
    currentCategoryUSD,
    currentCategoryTotalConverted,
    currentCategoryProfitKRW,
    currentCategoryProfitUSD,
    canonicalTradeRows,
    krwGrossProfit,
    usdGrossProfit,
    totalConvertedNetProfit,
    stockPerformanceSummary,
    dividendSummary,
    filteredHistory,
  } = usePortfolioMetrics({
    assets,
    trades,
    tradeLedger,
    autoDividends: reportedDividends,
    receivedDividends,
    historicalDividendRates: annualDividendFxRates,
    dividendAssetRegistry,
    exchangeRate,
    jpyKrwRate,
    currencyRates,
    selectedCategory,
    selectedDividendAsset,
    dividendFilter,
  });

  // 지금 보유 중인 종목과, 예전엔 보유했지만 지금은 판 종목(수령 이력만 남음)을
  // 나눠 보여준다 — 안 그러면 이미 정리한 종목이 지금 보유 목록 사이에 섞여 나온다.
  const { currentDividendSummaryGroups, historicalDividendSummaryGroups } = useMemo(() => {
    const groupsFor = (predicate) => [
      {
        id: 'domestic',
        label: '국내 주식 배당',
        description: '원화 · 국내 지급일 기준',
        items: dividendSummary.filter((summary) => summary.currency === 'KRW' && predicate(summary)),
      },
      {
        id: 'overseas',
        label: '해외 주식 배당',
        description: '현지 통화 · 한국 집계일 기준',
        items: dividendSummary.filter((summary) => summary.currency !== 'KRW' && predicate(summary)),
      },
    ].filter((group) => group.items.length > 0);

    return {
      currentDividendSummaryGroups: groupsFor((summary) => summary.isCurrentHolding),
      historicalDividendSummaryGroups: groupsFor((summary) => !summary.isCurrentHolding),
    };
  }, [dividendSummary]);
  const historicalDividendCount = useMemo(
    () => historicalDividendSummaryGroups.reduce((sum, group) => sum + group.items.length, 0),
    [historicalDividendSummaryGroups],
  );

  const annualDividendEvents = useMemo(() => buildAnnualDividendEvents({
    dividendSummary,
    assets: enhancedAssets,
    year: annualDividendYear,
  }), [annualDividendYear, dividendSummary, enhancedAssets]);
  const annualDividendFxLookupDates = useMemo(() => {
    const todayKey = formatKoreanDate();
    const candidates = [...annualDividendEvents, ...receivedDividends.map((dividend) => ({
      ...dividend,
      fxDate: getDividendOfficialPaymentDate(dividend) || getDividendReportingDate(dividend),
    }))];
    return [...new Set(candidates
      .filter((event) => (
        !event.isEstimated
        && event.currency === 'USD'
        && event.fxDate
        && event.fxDate < todayKey
        && !(Number(event.fxRate) > 0)
        && !(Number(annualDividendFxRates[event.fxDate]) > 0)
      ))
      .map((event) => event.fxDate))]
      .sort();
  }, [annualDividendEvents, receivedDividends, annualDividendFxRates]);
  const annualDividendFxLookupKey = annualDividendFxLookupDates.join('|');

  useEffect(() => {
    if (!annualDividendFxLookupKey) return undefined;
    let cancelled = false;
    const lookupDates = annualDividendFxLookupKey.split('|');

    Promise.all(lookupDates.map(async (date) => ({
      date,
      rate: await fetchUsdKrwRateByDate(date),
    }))).then((results) => {
      if (cancelled) return;
      setAnnualDividendFxRates((previous) => {
        const next = { ...previous };
        let changed = false;
        results.forEach(({ date, rate }) => {
          if (!(Number(rate) > 0) || Number(next[date]) === Number(rate)) return;
          next[date] = Number(rate);
          changed = true;
        });
        if (!changed) return previous;
        saveJson(ANNUAL_DIVIDEND_FX_RATES_STORAGE_KEY, next);
        return next;
      });
    }).catch(() => {
      // 네트워크 실패 시 현재 환율로 우선 표시하고 다음 방문 때 다시 확인한다.
    });

    return () => {
      cancelled = true;
    };
  }, [annualDividendFxLookupKey]);

  const annualDividendTrend = useMemo(() => summarizeAnnualDividendTrend({
    events: annualDividendEvents,
    resolveKrwRate: (event) => resolveDividendIncomeRate(event, {
      exchangeRate, jpyKrwRate, currencyRates,
      historicalRates: event.isEstimated ? {} : annualDividendFxRates,
    }).rate,
  }), [
    annualDividendEvents,
    annualDividendFxRates,
    currencyRates,
    exchangeRate,
    jpyKrwRate,
  ]);

  const visibleDetailAssets = useMemo(() => (
    [...(selectedCategory ? subChartData : enhancedAssets)]
      .filter((asset) => isPortfolioAssetCategory(asset.category))
      .map((asset) => ({
        ...asset,
        displayBuyDate: getDividendStartDate(asset, tradeLedger),
      }))
      .sort((a, b) => {
        const categoryDelta = getAssetCategoryOrder(a.category) - getAssetCategoryOrder(b.category);
        if (categoryDelta !== 0) return categoryDelta;
        return b.currentKRW - a.currentKRW;
      })
  ), [enhancedAssets, selectedCategory, subChartData, tradeLedger]);
  const dividendIncome = useMemo(() => summarizeDividendIncome({
    dividends: reportedDividends,
    exchangeRate, jpyKrwRate, currencyRates, historicalRates: annualDividendFxRates,
  }), [reportedDividends, exchangeRate, jpyKrwRate, currencyRates, annualDividendFxRates]);

  const dashboardSummary = useMemo(() => {
    // 포트폴리오 화면은 국내/해외 주식만 기준으로 한다. 저장돼 있던 현금·원자재가
    // 분모에 섞이면 실제 주식 수익률이 희석되거나 부풀어 보인다.
    const investedAssets = portfolioAssets;

    const purchaseKRW = investedAssets.reduce((sum, asset) => sum + asset.purchaseKRW, 0);
    const investedPurchaseKRW = investedAssets.reduce((sum, asset) => sum + asset.purchaseKRW, 0);
    const evaluationProfitKRW = investedAssets.reduce((sum, asset) => sum + asset.profitKRW, 0);
    const investedProfitKRW = investedAssets.reduce((sum, asset) => sum + asset.profitKRW, 0);
    // 실현손익(원화/달러 매매 순수익)처럼, 아직 안 판 종목의 평가손익도 국내(원화)·
    // 해외(달러)로 나눠 보고 싶을 때가 있다 — 합산 원화환산 값만으로는 어느 쪽이
    // 잘하고 있는지 알 수 없다.
    const krwEvaluationProfit = investedAssets
      .filter((asset) => asset.currency === 'KRW')
      .reduce((sum, asset) => sum + asset.profitKRW, 0);
    const usdEvaluationProfit = investedAssets
      .filter((asset) => asset.currency === 'USD')
      .reduce((sum, asset) => sum + asset.profitNative, 0);
    const dividendKRW = dividendIncome.totalKRW;
    const dividendByCurrency = Object.fromEntries(dividendIncome.totals.map(({ currency, amount }) => [currency, amount]));
    const totalReturnPercent = investedPurchaseKRW > 0 ? (investedProfitKRW / investedPurchaseKRW) * 100 : 0;

    return {
      purchaseKRW,
      investedPurchaseKRW,
      evaluationProfitKRW,
      investedProfitKRW,
      krwEvaluationProfit,
      usdEvaluationProfit,
      totalReturnPercent,
      dividendKRW,
      dividendByCurrency,
    };
  }, [portfolioAssets, dividendIncome]);
  const includeDividendsInReturn = targetPortfolio.includeDividendsInReturn === true;
  // Receipt-only years must remain visible, including holdings bought in prior years.
  const annualPerformanceYears = useMemo(() => getAnnualTradeYears({
    rows: [...canonicalTradeRows, ...dividendIncome.events],
    currentYear: new Date().getFullYear(),
  }), [canonicalTradeRows, dividendIncome]);
  const annualPerformances = useMemo(() => [...new Set([...annualPerformanceYears, annualReturnYear])].map((year) => {
    const income = summarizeDividendIncome({
      dividends: reportedDividends, year,
      exchangeRate, jpyKrwRate, currencyRates, historicalRates: annualDividendFxRates,
    });
    return {
      ...calculateAnnualIncomeReturn({
        rows: canonicalTradeRows, assets, year, exchangeRate, jpyKrwRate, currencyRates,
        dividendIncome: income, includeDividends: includeDividendsInReturn,
      }),
      dividendIncome: income,
    };
  }), [
    annualPerformanceYears, annualReturnYear, canonicalTradeRows, assets, reportedDividends,
    exchangeRate, jpyKrwRate, currencyRates, annualDividendFxRates, includeDividendsInReturn,
  ]);
  // 증권사 앱처럼 기록이 없는 지난해로도 돌아가 볼 수 있게 한다. 기록이 없는
  // 해는 "기록 없음" 카드로 보여주고, 기록이 그보다 오래됐으면 그 해까지 연다.
  const ANNUAL_NAV_LOOKBACK_YEARS = 10;
  const earliestAnnualYear = Math.min(
    annualPerformanceYears.length > 0 ? Math.min(...annualPerformanceYears) : new Date().getFullYear(),
    new Date().getFullYear() - ANNUAL_NAV_LOOKBACK_YEARS,
  );
  const selectedAnnualPerformance = annualPerformances.find((performance) => performance.year === annualReturnYear);
  /**
   * 해외주식 양도소득세(추정).
   * 연간 해외 종목 손익을 통산해 250만원 기본공제를 뺀 뒤 22%를 매긴다.
   * 화면의 실현손익과 달리 환차익도 과세 대상이라 매수일/매도일 환율을 각각 쓴다.
   */
  const overseasCapitalGainsTax = useMemo(() => calculateOverseasCapitalGainsTax({
    rows: canonicalTradeRows,
    year: annualReturnYear,
    /**
     * 화면 표시용 getCachedKrwRate는 모르는 통화에 1을 돌려준다(HK$1,000,000이 100만원이 된다).
     * 세액에 그대로 흘러들면 안 되므로, 여기서는 실측 환율만 쓰고 모르면 0을 돌려
     * 그 매도 건이 "계산에서 빠졌다"고 표시되게 한다.
     */
    resolveKrwRate: (currency) => {
      const code = String(currency || 'KRW').toUpperCase();
      if (code === 'KRW') return 1;
      if (code === 'USD') return Number(exchangeRate) > 0 ? Number(exchangeRate) : 0;
      if (code === 'JPY') return Number(jpyKrwRate) > 0 ? Number(jpyKrwRate) : 0;
      return Number(currencyRates[code]) > 0 ? Number(currencyRates[code]) : 0;
    },
  }), [canonicalTradeRows, annualReturnYear, currencyRates, exchangeRate, jpyKrwRate]);
  // Historical snapshots remain available in saved data; no unused daily rows are appended.
  const dividendCurrencyParts = useMemo(() => (
    Object.entries(dashboardSummary.dividendByCurrency || {})
      .filter(([, amount]) => Math.abs(Number(amount) || 0) > 0.000001)
      .sort(([leftCurrency], [rightCurrency]) => {
        const order = { KRW: 0, USD: 1, JPY: 2 };
        return (order[leftCurrency] ?? 9) - (order[rightCurrency] ?? 9);
      })
      .map(([currency, amount]) => formatMoney(amount, currency))
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
  const dividendCalendarEvents = useMemo(() => (
    selectDividendMonthEvents(annualDividendEvents, calendarMonth)
  ), [annualDividendEvents, calendarMonth]);
  const dividendCalendarEventsByDate = useMemo(() => (
    dividendCalendarEvents.reduce((acc, event) => {
      if (!acc[event.date]) acc[event.date] = [];
      acc[event.date].push(event);
      return acc;
    }, {})
  ), [dividendCalendarEvents]);
  const dividendCalendarMonthlySummary = useMemo(() => (
    summarizeDividendCalendarEvents(dividendCalendarEvents)
  ), [dividendCalendarEvents]);
  const expandedCalendarEvents = useMemo(() => (
    expandedCalendarDate ? (dividendCalendarEventsByDate[expandedCalendarDate] || []) : []
  ), [dividendCalendarEventsByDate, expandedCalendarDate]);
  const selectedCalendarEvent = useMemo(() => (
    dividendCalendarEvents.find(event => event.id === selectedCalendarEventId) || dividendCalendarEvents[0] || null
  ), [dividendCalendarEvents, selectedCalendarEventId]);
  useEffect(() => {
    if (!selectedCalendarEventId) return;
    if (!dividendCalendarEvents.some(event => event.id === selectedCalendarEventId)) {
      setSelectedCalendarEventId('');
    }
  }, [dividendCalendarEvents, selectedCalendarEventId]);
  useEffect(() => {
    if (!expandedCalendarDate) return;
    if (!dividendCalendarEventsByDate[expandedCalendarDate]) {
      setExpandedCalendarDate('');
    }
  }, [dividendCalendarEventsByDate, expandedCalendarDate]);
  const addMarketCalendarKeyword = useCallback((value) => {
    const nextKeyword = createMarketCalendarKeyword(value);
    if (!nextKeyword) return;
    setMarketCalendarKeywords((previous) => normalizeMarketCalendarKeywords([
      ...previous,
      nextKeyword,
    ]));
  }, []);
  const removeMarketCalendarKeyword = useCallback((keywordId) => {
    setMarketCalendarKeywords((previous) => (
      previous.filter((entry) => entry.id !== keywordId)
    ));
  }, []);
  const targetBudgetKRW = parseNumber(targetPortfolio.budget) || totalConvertedKRW;
  const targetCategoryTotalPercent = targetPortfolio.categories.reduce((sum, category) => sum + (Number(category.percent) || 0), 0);
  const targetPortfolioGuide = useMemo(() => {
    const rate = exchangeRate || 1350;
    const yenRate = jpyKrwRate || 9.5;
    const toKrwPrice = (nativePrice, currency) => {
      return nativePrice * getCachedKrwRate(currency, currencyRates, rate, yenRate);
    };
    const toNativePrice = (krwPrice, currency) => {
      return krwPrice / getCachedKrwRate(currency, currencyRates, rate, yenRate);
    };

    return targetPortfolio.categories.map((categoryTarget) => {
      const categoryAssets = enhancedAssets.filter((asset) => asset.category === categoryTarget.id);
      const currentValue = categoryAssets.reduce((sum, asset) => sum + asset.currentKRW, 0);
      const targetValue = targetBudgetKRW * ((Number(categoryTarget.percent) || 0) / 100);
      const groups = getTargetGroups(targetPortfolio, categoryTarget.id);
      const groupTotalPercent = groups.reduce((sum, group) => sum + (Number(group.percent) || 0), 0);
      // 목표 종목에 실제로 연결된(매칭된) 보유 자산을 추적해, 계획에 아예 없는
      // 보유 종목(리밸런싱 계획이 놓치고 있는 것)을 따로 골라낼 수 있게 한다.
      const matchedAssets = new Set();

      const enrichedGroups = groups.map((group) => {
        const groupTargetValue = targetValue * ((Number(group.percent) || 0) / 100);
        const items = group.items || [];
        const itemTotalPercent = items.reduce((sum, item) => sum + (Number(item.percent) || 0), 0);
        const enrichedItems = items.map((item) => {
          const itemCurrency = getTargetItemCurrency(categoryTarget.id, item.ticker, item.currency);
          const matchedAsset = categoryAssets.find((asset) => (
            asset.name === item.name || (item.ticker && asset.ticker?.toUpperCase() === item.ticker.toUpperCase())
          ));
          if (matchedAsset) matchedAssets.add(matchedAsset);
          const currentItemValue = matchedAsset?.currentKRW || 0;
          const itemTargetValue = itemTotalPercent > 0
            ? groupTargetValue * ((Number(item.percent) || 0) / itemTotalPercent)
            : 0;
          const gapValue = itemTargetValue - currentItemValue;
          const currentPriceKRW = matchedAsset
            ? toKrwPrice(matchedAsset.nativeCurrentPrice, matchedAsset.currency)
            : parseNumber(item.price);
          const currentPriceNative = matchedAsset
            ? matchedAsset.nativeCurrentPrice
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
            // 이름·티커가 어긋나 매칭이 조용히 실패하면 "매수 필요"가 실제보다
            // 크게 나오는데, 화면에는 원인이 안 보인다. 매칭 성공 여부를 그대로 넘긴다.
            isMatched: Boolean(matchedAsset),
          };
        });

        return {
          ...group,
          targetValue: groupTargetValue,
          currentValue: enrichedItems.reduce((sum, item) => sum + item.currentValue, 0),
          itemTotalPercent,
          items: enrichedItems,
        };
      });

      const unassignedAssets = categoryAssets.filter((asset) => !matchedAssets.has(asset));
      // 표를 스크롤하지 않고도 이 분류에 매수/매도가 몇 건 필요한지 헤더에서
      // 바로 보이게, 폴더별로 흩어진 종목 조정 방향을 한 번에 센다.
      const buyCount = enrichedGroups.reduce((sum, group) => (
        sum + group.items.filter((item) => item.adjustmentSide === 'buy' && Math.abs(item.gapValue) > 1).length
      ), 0);
      const sellCount = enrichedGroups.reduce((sum, group) => (
        sum + group.items.filter((item) => item.adjustmentSide === 'sell' && Math.abs(item.gapValue) > 1).length
      ), 0);

      return {
        ...categoryTarget,
        currentValue,
        targetValue,
        gapValue: targetValue - currentValue,
        currentPercent: targetBudgetKRW > 0 ? (currentValue / targetBudgetKRW) * 100 : 0,
        groupTotalPercent,
        groups: enrichedGroups,
        buyCount,
        sellCount,
        // 목표 계획(폴더·종목)에 하나도 안 걸린 보유 자산. 팔아야 할지 계획에
        // 추가해야 할지는 사용자가 판단하되, 최소한 눈에는 보이게 한다.
        unassignedAssets,
        unassignedValue: unassignedAssets.reduce((sum, asset) => sum + asset.currentKRW, 0),
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
  // "현재 포트폴리오" 파이도 "목표" 파이와 같은 카테고리/폴더 선택을 그대로 따라가며
  // 드릴다운한다 — 같은 구간을 눌러야 두 파이를 나란히 비교할 수 있다.
  const targetCurrentDrilldownChartData = useMemo(() => {
    if (!selectedTargetGuide) return targetCurrentChartData;

    let cumulativePercent = 0;
    if (selectedTargetGroupGuide) {
      const items = selectedTargetGroupGuide.items.length > 0
        ? selectedTargetGroupGuide.items
        : [{ id: `${selectedTargetGroupGuide.id}-empty`, name: '종목 없음', currentValue: 0 }];
      const itemTotalValue = items.reduce((sum, item) => sum + (Number(item.currentValue) || 0), 0);

      return items.map((item, index) => {
        const percent = itemTotalValue > 0 ? ((Number(item.currentValue) || 0) / itemTotalValue) * 100 : 0;
        const startPercent = cumulativePercent;
        cumulativePercent += percent;

        return {
          id: `current-item-${item.id}`,
          name: item.name || item.ticker || '이름 없음',
          value: item.currentValue,
          percent,
          startPercent,
          color: getCategoryDetailColor(selectedTargetGuide.id, index),
        };
      });
    }

    const groupSlices = selectedTargetGuide.groups.map((group) => ({
      id: `current-drill-${group.id}`,
      name: group.name || '미분류',
      groupId: group.id,
      value: group.currentValue,
    }));
    // 목표 폴더 어디에도 안 걸린 보유 자산은 "미분류"로 따로 보여준다 — 클릭은
    // 안 되지만(목표 폴더가 아니므로), 값이 존재한다는 것 자체가 신호다.
    if (selectedTargetGuide.unassignedValue > 0) {
      groupSlices.push({
        id: `current-drill-unassigned`,
        name: '미분류(계획 없음)',
        value: selectedTargetGuide.unassignedValue,
      });
    }
    const slices = groupSlices.length > 0
      ? groupSlices
      : [{ id: `${selectedTargetGuide.id}-empty`, name: '보유 없음', value: 0 }];
    const totalValue = slices.reduce((sum, slice) => sum + (Number(slice.value) || 0), 0);

    return slices.map((slice, index) => {
      const percent = totalValue > 0 ? ((Number(slice.value) || 0) / totalValue) * 100 : 0;
      const startPercent = cumulativePercent;
      cumulativePercent += percent;

      return {
        ...slice,
        percent,
        startPercent,
        color: getCategoryDetailColor(selectedTargetGuide.id, index),
      };
    });
  }, [selectedTargetGuide, selectedTargetGroupGuide, targetCurrentChartData]);

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
      const rate = exchangeRate || 1350;
      const currentJpyKrwRate = jpyKrwRate || currencyRates.JPY || (await fetchKrwRate('JPY')) || 9.5;
      const nextCurrencyRates = { ...currencyRatesRef.current, KRW: 1, USD: rate, JPY: currentJpyKrwRate };
      const getCurrencyRate = async (currency = 'KRW') => {
        const code = String(currency || 'KRW').toUpperCase();
        if (code === 'KRW') return 1;
        if (nextCurrencyRates[code]) return nextCurrencyRates[code];

        const fetchedRate = await fetchKrwRate(code);
        if (fetchedRate) nextCurrencyRates[code] = fetchedRate;
        return nextCurrencyRates[code] || 1;
      };
      const syncTargets = [];
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
      let liveCount = 0;
      let cachedCount = 0;
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
          // enhancedAssets가 계산해둔 현지 통화 가격을 쓴다.
          // originalCurrentPrice가 없을 때 currentPrice(원화)를 그대로 쓰면 환율이 두 번 곱해진다.
          const nativePrice = Number(matchedAsset.nativeCurrentPrice) || 0;
          if (nativePrice > 0) {
            const priceKRW = await toKrwPrice(nativePrice, matchedAsset.currency);
            const hasLiveHoldingPrice = matchedAsset.quoteStatus === 'live';
            if (hasLiveHoldingPrice) liveCount += 1;
            else cachedCount += 1;
            updates.push({
              ...target,
              currency: matchedAsset.currency,
              priceKRW,
              nativePrice,
              source: hasLiveHoldingPrice ? 'holding-live' : 'holding-cached',
            });
            continue;
          }
        }

        let stockQuote = null;
        try {
          stockQuote = await fetchStockQuote({
            ticker: target.ticker,
            category: target.categoryId,
            currency: target.currency,
          });
        } catch {
          stockQuote = null;
        }
        const fetchedPrice = stockQuote?.price ?? null;
        const fetchedCurrency = stockQuote?.currency || target.currency || 'KRW';

        if (Number.isFinite(Number(fetchedPrice)) && Number(fetchedPrice) > 0) {
          liveCount += 1;
          updates.push({
            ...target,
            currency: fetchedCurrency,
            nativePrice: fetchedPrice,
            priceKRW: await toKrwPrice(fetchedPrice, fetchedCurrency),
            source: stockQuote?.source ? `market-${stockQuote.source}` : 'market',
          });
        } else if (target.currentPriceKRW > 0) {
          cachedCount += 1;
          const cachedRate = await getCurrencyRate(target.currency);
          updates.push({
            ...target,
            nativePrice: target.currentPriceNative || (target.currentPriceKRW / cachedRate),
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
        setTargetPortfolio(prev => {
          // 값이 실제로 바뀐 항목이 하나도 없으면 상태를 갱신하지 않는다.
          // 그러지 않으면 시세가 같아도 매 사이클마다 Firestore 문서 전체가 다시 올라간다.
          let touched = false;
          const syncedAt = new Date().toISOString();

          const nextGroups = Object.fromEntries(prev.categories.map(category => [
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

                const nextPrice = String(Math.round(update.priceKRW));
                const nextNativePrice = String(update.nativePrice);
                const unchanged = item.price === nextPrice
                  && item.nativePrice === nextNativePrice
                  && item.currency === update.currency
                  && item.priceSource === update.source;

                if (unchanged) return item;

                touched = true;
                return {
                  ...item,
                  currency: update.currency,
                  price: nextPrice,
                  nativePrice: nextNativePrice,
                  priceSource: update.source,
                  priceUpdatedAt: syncedAt,
                };
              }),
            })),
          ]));

          if (!touched) return prev;

          return {
            ...prev,
            groups: { ...prev.groups, ...nextGroups },
          };
        });
      }

      const statusParts = [];
      if (liveCount > 0) statusParts.push(`시세 조회 ${liveCount.toLocaleString()}개 성공`);
      if (cachedCount > 0) statusParts.push(`저장 가격 ${cachedCount.toLocaleString()}개`);
      if (failCount > 0) statusParts.push(`실패 ${failCount.toLocaleString()}개`);
      setTargetPriceSyncStatus(
        statusParts.length > 0
          ? statusParts.join(' / ')
          : '현재가를 가져오지 못했습니다. 티커를 확인해주세요.'
      );
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetTickerSnapshotKey, enhancedAssets, exchangeRate, jpyKrwRate, currencyRates, refreshTrigger]);

  const tradeRecords = useMemo(() => {
    // 해석기를 빼먹으면 이 목록의 krwPnl이 통째로 null이 되어, 매매 기록 탭의
    // 실현손익만 "손익 × 오늘 환율"로 근사돼 포트폴리오 탭 카드와 어긋난다.
    const canonicalRows = buildCanonicalTradeRows({
      tradeLedger, trades, resolveKrwRate: resolveTradeRowKrwRate,
    });
    return canonicalRows.map((entry) => ({
      ...entry,
      sourceType: tradeLedger.length > 0 ? 'ledger' : 'trade',
    }));
  }, [tradeLedger, trades]);
  const activeMemos = useMemo(() => selectActiveMemoRecords(memos), [memos]);
  const enrichedMemos = useMemo(() => activeMemos.map((memo) => {
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
  }), [activeMemos, trades]);
  const integratedTradeRecords = useMemo(() => (
    combineTradesWithMemos(tradeRecords, enrichedMemos)
  ), [tradeRecords, enrichedMemos]);
  const tradeStockFilterOptions = useMemo(() => (
    buildStockSearchOptions(integratedTradeRecords)
  ), [integratedTradeRecords]);
  const manualTradeStockOptions = useMemo(() => (
    [...new Set(integratedTradeRecords.map((record) => record.name).filter(Boolean))].sort()
  ), [integratedTradeRecords]);
  const visibleTrades = useMemo(() => {
    const stockFiltered = tradeStockFilter === 'all'
      ? integratedTradeRecords
      : integratedTradeRecords.filter((trade) => trade.name === tradeStockFilter);
    const sideFiltered = tradeSideFilter === 'all'
      ? stockFiltered
      : stockFiltered.filter((trade) => getTradeSide(trade) === tradeSideFilter);
    return sortTradeRecords(sideFiltered, tradeSortMode);
  }, [integratedTradeRecords, tradeStockFilter, tradeSideFilter, tradeSortMode]);
  const displayedTrades = useMemo(() => (
    visibleTrades.slice(0, tradeVisibleCount)
  ), [visibleTrades, tradeVisibleCount]);
  const hasMoreTrades = visibleTrades.length > displayedTrades.length;

  useEffect(() => {
    setTradeVisibleCount(TRADE_PAGE_SIZE);
  }, [tradeStockFilter, tradeSideFilter, tradeSortMode]);
  const tradeSummary = useMemo(() => {
    return buildTradeSummary(
      visibleTrades.filter((record) => !record.isUnlinkedMemo),
      exchangeRate || 1350,
      jpyKrwRate || 9.5,
      currencyRates,
    );
  }, [visibleTrades, exchangeRate, jpyKrwRate, currencyRates]);

  // 자산 삭제는 연결된 거래·메모·원장까지 함께 지우고 되돌릴 수 없다.
  // 무엇이 같이 지워지는지 먼저 보여준 뒤 확인을 받는다.
  const requestRemoveAsset = (id, e) => {
    if (e) e.stopPropagation();
    const assetToRemove = assets.find(asset => asset.id === id);
    if (!assetToRemove) return;

    setAssetPendingRemoval({
      asset: assetToRemove,
      tradeCount: trades.filter(trade => isRecordForAsset(trade, assetToRemove)).length,
      memoCount: activeMemos.filter(memo => isRecordForAsset(memo, assetToRemove)).length,
      ledgerCount: tradeLedger.filter(entry => isRecordForAsset(entry, assetToRemove)).length,
      dividendCount: autoDividends.filter(dividend => isRecordForAsset(dividend, assetToRemove)).length,
    });
  };

  const confirmRemoveAsset = () => {
    const assetToRemove = assetPendingRemoval?.asset;
    if (!assetToRemove) return;

    setAssets(prevAssets => prevAssets.filter(a => a.id !== assetToRemove.id));
    setTrades(prevTrades => prevTrades.filter(trade => !isRecordForAsset(trade, assetToRemove)));
    setMemos(prevMemos => prevMemos.filter(memo => !isRecordForAsset(memo, assetToRemove)));
    setTradeLedger(prevLedger => prevLedger.filter(entry => !isRecordForAsset(entry, assetToRemove)));
    setAssetPendingRemoval(null);
    addLog(`[${assetToRemove.name}] 자산과 관련 기록을 삭제했습니다.`, 'success');
  };

  const removeTrade = (record, e) => {
    if (e) e.stopPropagation();
    const hasLinkedMemo = record.memoRecordId !== null && record.memoRecordId !== undefined;
    const isSellRecord = getTradeSide(record) === 'sell';

    if (record.sourceType === 'ledger') {
      const nextLedger = tradeLedger.filter(entry => entry.id !== record.id);
      setTradeLedger(nextLedger);
      setAssets(prevAssets => {
        const reconciledAssets = reconcileAssetsAfterTradeDeletion(
          mergeUniqueAssets(prevAssets),
          nextLedger,
          record,
        );
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

    if (hasLinkedMemo) {
      const deletedAt = new Date().toISOString();
      setMemos((previous) => previous.map((memo) => (
        String(memo.id) === String(record.memoRecordId)
          ? { ...memo, memo: '', status: 'deleted', deletedAt, updatedAt: deletedAt }
          : memo
      )));
      setExpandedTradeMemoId('');
    }

    addLog(
      isSellRecord
        ? `매도 기록${hasLinkedMemo ? '과 연결된 메모를 ' : '을 '}삭제하고 보유 수량을 다시 계산했습니다.`
        : hasLinkedMemo
          ? '매수 기록과 연결된 메모를 함께 삭제하고 보유 수량을 다시 계산했습니다.'
          : '매수 기록을 삭제하고 보유 수량을 다시 계산했습니다.',
      'success',
    );
  };

  const removeTradeMemo = (record, e) => {
    if (e) e.stopPropagation();
    if (record.memoRecordId === null || record.memoRecordId === undefined) return;

    const deletedAt = new Date().toISOString();
    setMemos((previous) => previous.map((memo) => (
      String(memo.id) === String(record.memoRecordId)
        ? { ...memo, memo: '', status: 'deleted', deletedAt, updatedAt: deletedAt }
        : memo
    )));
    setExpandedTradeMemoId('');
    addLog(
      record.isUnlinkedMemo
        ? '보존된 미연결 기록을 삭제했습니다.'
        : '메모만 삭제했습니다. 매매 기록은 유지됩니다.',
      'success',
    );
  };

  /**
   * 과거 매매 기록의 거래일·단가·수수료·메모를 한 번에 고친다.
   * 원장(보유 수량·평단의 원본), 옛 매도 기록(trades), 연결된 메모가 같은 거래를 따로
   * 들고 있어서 셋을 함께 고쳐야 한다. 하나만 바꾸면 메모가 '미연결 기록'으로 떨어진다.
   * 저장하면 true를 돌려 편집기를 닫게 한다.
   */
  const updateTradeRecord = async (record, draft) => {
    const current = getEditableTradeFields(record);
    const nextDate = draft.date;
    const nextPrice = parseNumber(draft.price);
    // 빈 칸은 '수수료 없음'으로 본다. 0원도 실제로 있는 값이다.
    const nextBrokerFee = parseNumber(draft.brokerFee);
    const memoText = String(draft.memo || '').trim();
    const tradeChanged = nextDate !== current.date
      || Math.abs(nextPrice - current.price) > 1e-9
      || Math.abs(nextBrokerFee - current.brokerFee) > 1e-9;
    const memoChanged = memoText !== String(record.memo || '').trim();
    const hasMemoRecord = record.memoRecordId !== null && record.memoRecordId !== undefined;
    const action = current.side === 'sell' ? '매도' : '매수';

    if (!tradeChanged && !memoChanged) {
      setExpandedTradeMemoId('');
      return true;
    }
    if (tradeChanged) {
      const validationError = validateTradeRecordEdit({ date: nextDate, price: nextPrice, brokerFee: nextBrokerFee });
      if (validationError) {
        addLog(validationError, 'error');
        return false;
      }
    }

    const editsLedger = tradeChanged && !record.isUnlinkedMemo && record.sourceType === 'ledger';
    const editsLegacyTrade = tradeChanged && !record.isUnlinkedMemo && record.sourceType === 'trade';

    // 해외 종목의 거래일을 옮기면 원화 원금·손익도 그날 환율로 다시 잡아야 한다.
    let fxRate;
    const currency = String(record.currency || 'KRW').toUpperCase();
    if (editsLedger && currency !== 'KRW' && nextDate !== current.date) {
      const rate = await fetchKrwRateByDate(currency, nextDate).catch(() => 0);
      if (!(Number(rate) > 0)) {
        addLog('바꾼 거래일의 환율을 받아오지 못했습니다. 잠시 후 다시 저장해주세요.', 'error');
        return false;
      }
      fxRate = Number(rate);
    }

    const updatedAt = new Date().toISOString();
    const editValues = { date: nextDate, price: nextPrice, brokerFee: nextBrokerFee };
    const isSameLegacySell = (trade, legacyTradeId) => (
      (legacyTradeId && String(trade.id) === legacyTradeId)
      || (
        trade.name === record.name
        && trade.sellDate === current.date
        && numbersMatch(trade.quantity, record.quantity)
        && numbersMatch(trade.sellPrice, current.price)
      )
    );
    const editLegacySell = (trade) => ({
      ...trade,
      ...toLegacySellTradePatch(buildTradeRecordEditPatch({ ...trade, side: 'sell' }, editValues)),
      updatedAt,
    });
    let tradePatch = null;

    if (editsLedger) {
      // 환율을 기다리는 사이 원장이 바뀌었을 수 있으니 최신 원장에서 고친다.
      const currentLedger = tradeLedgerRef.current;
      const entry = currentLedger.find((row) => String(row.id) === String(record.id));
      if (!entry) {
        addLog('수정할 매매 기록을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error');
        return false;
      }
      tradePatch = buildTradeRecordEditPatch(entry, { ...editValues, fxRate });
      const nextLedger = currentLedger.map((row) => (row === entry ? { ...entry, ...tradePatch, updatedAt } : row));
      const assetKey = getTradeAssetKey(entry);
      const rowsOfAsset = (ledger) => ledger.filter((row) => getTradeAssetKey(row) === assetKey);
      if (countUnmatchedSells(rowsOfAsset(nextLedger)) > countUnmatchedSells(rowsOfAsset(currentLedger))) {
        addLog('이 날짜로 옮기면 그때까지 산 수량보다 판 수량이 많아집니다. 거래일을 확인해주세요.', 'error');
        return false;
      }

      setTradeLedger(nextLedger);
      setAssets((prevAssets) => reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), nextLedger));
      if (getTradeSide(entry) === 'sell') {
        const sourceId = String(entry.sourceId || '');
        const legacyTradeId = sourceId.startsWith('trade-') ? sourceId.slice('trade-'.length) : '';
        setTrades((prevTrades) => prevTrades.map((trade) => (
          isSameLegacySell(trade, legacyTradeId) ? editLegacySell(trade) : trade
        )));
      }
    } else if (editsLegacyTrade) {
      const legacyTrade = trades.find((trade) => String(trade.id) === String(record.id));
      if (!legacyTrade) {
        addLog('수정할 매매 기록을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error');
        return false;
      }
      tradePatch = buildTradeRecordEditPatch({ ...legacyTrade, side: 'sell' }, editValues);
      setTrades((prevTrades) => prevTrades.map((trade) => (
        String(trade.id) === String(record.id) ? editLegacySell(trade) : trade
      )));
    }

    const deletesMemo = memoChanged && !memoText && hasMemoRecord && !record.isUnlinkedMemo;
    if (hasMemoRecord) {
      setMemos((previous) => previous.map((memo) => {
        if (String(memo.id) !== String(record.memoRecordId)) return memo;
        // 미연결 메모는 그 자체가 기록이라 거래일·단가를 메모에 직접 고친다.
        const memoTradePatch = record.isUnlinkedMemo
          ? (tradeChanged ? buildTradeRecordEditPatch(memo, editValues) : null)
          : tradePatch;
        if (deletesMemo) {
          return { ...memo, ...memoTradePatch, memo: '', status: 'deleted', deletedAt: updatedAt, updatedAt };
        }
        return {
          ...memo,
          ...memoTradePatch,
          memo: memoChanged ? memoText : memo.memo,
          // 거래일을 옮기면 이름·날짜로는 더 이상 짝이 맞지 않으니 원장 id로 붙잡아 둔다.
          ledgerId: record.isUnlinkedMemo ? (memo.ledgerId || '') : record.id,
          updatedAt,
        };
      }));
    } else if (memoText) {
      const source = tradePatch ? { ...record, ...tradePatch } : record;
      setMemos((previous) => [{
        id: Date.now() + Math.random(),
        assetId: source.assetId ?? null,
        name: source.name,
        ticker: source.ticker || '',
        category: source.category || '',
        currency: source.currency || 'KRW',
        round: getTradeRound(source),
        side: current.side,
        action,
        quantity: source.quantity,
        price: getEditableTradeFields(source).price,
        date: getEditableTradeFields(source).date,
        pnl: getRecordPnl(source),
        grossPnl: source.grossPnl,
        brokerId: source.brokerId || '',
        brokerName: source.brokerName || '',
        brokerFeeRate: source.brokerFeeRate || 0,
        brokerFeeRatePercent: source.brokerFeeRatePercent || 0,
        brokerFee: source.brokerFee || 0,
        sellTaxRatePercent: source.sellTaxRatePercent || 0,
        sellTax: source.sellTax || 0,
        memo: memoText,
        ledgerId: record.id,
        createdAt: updatedAt,
        updatedAt,
      }, ...previous]);
    }

    setExpandedTradeMemoId('');
    if (tradeChanged) {
      addLog(
        editsLedger
          ? `${record.name} ${action} 기록을 고치고 보유 수량·평단·손익을 다시 계산했습니다.`
          : `${record.name} ${action} 기록을 고쳤습니다.`,
        'success',
      );
    } else {
      addLog(deletesMemo ? '메모를 삭제했습니다. 매매 기록은 유지됩니다.' : '매매 메모를 저장했습니다.', 'success');
    }
    return true;
  };

  const getMeasuredKrwRate = (currency) => {
    const code = String(currency || 'KRW').toUpperCase();
    if (code === 'KRW') return 1;
    if (code === 'USD') return Number(exchangeRate) > 0 ? Number(exchangeRate) : 0;
    if (code === 'JPY') return Number(jpyKrwRate) > 0 ? Number(jpyKrwRate) : 0;
    return Number(currencyRates[code]) > 0 ? Number(currencyRates[code]) : 0;
  };

  const addLedgerEntry = ({
    asset,
    side,
    quantity,
    price,
    date,
    pnl = 0,
    sourceId,
    fxRate: explicitFxRate = 0,
    grossPnl = null,
    brokerId = '',
    brokerName = '',
    brokerFeeRate = 0,
    brokerFeeRatePercent = 0,
    brokerFee = 0,
    sellTaxRatePercent = 0,
    sellTax = 0,
    buyFeeApplied = null,
  }) => {
    // 과거 날짜로 입력한 거래에 '오늘' 환율을 찍으면 원금이 통째로 틀어진다.
    // 거래일이 오늘일 때만 지금 환율을 쓰고, 지난 날짜는 0으로 두었다가 그날 환율을 받아 채운다.
    // 단, 호출한 쪽이 이미 쓴 환율을 알려줬다면(원화로 입력한 경우) 그것을 최우선으로 남긴다.
    const knownFxRate = Number(explicitFxRate) > 0 ? Number(explicitFxRate) : 0;
    const isTradedToday = date === formatKoreanDate();
    const entry = buildLedgerEntry({
      sourceId,
      asset,
      side,
      quantity,
      price,
      date,
      pnl,
      grossPnl,
      brokerId,
      brokerName,
      brokerFeeRate,
      brokerFeeRatePercent,
      brokerFee,
      sellTaxRatePercent,
      sellTax,
      buyFeeApplied,
      // 환율을 아직 못 받아온 상태의 추정치(1350 등)를 각인하면 영영 보정되지 않으므로
      // 실측값이 있을 때만 남기고, 없으면 0으로 두어 나중에 백필이 처리하게 한다.
      fxRate: knownFxRate || (isTradedToday ? getMeasuredKrwRate(asset.currency) : 0),
    });
    setTradeLedger(prevLedger => [entry, ...prevLedger]);

    if (!knownFxRate && !isTradedToday && entry.currency === 'USD' && date) {
      fetchUsdKrwRateByDate(date)
        .then((rate) => {
          if (!(Number(rate) > 0)) return;
          setTradeLedger(prevLedger => prevLedger.map(row => (
            row.id === entry.id ? { ...row, fxRate: Number(rate) } : row
          )));
        })
        .catch(() => {});
    }
  };

  /**
   * 이미 쌓여 있는 원장에는 fxRate가 없다.
   * 원화가 아닌 기록만 골라 거래일 기준 환율을 한 번씩 받아와 채워 넣는다.
   * (한 번 채우면 다시 요청하지 않는다.)
   */
  const fxBackfillDoneRef = useRef(false);
  const fxRateRepairDoneRef = useRef(loadJson(FX_RATE_REPAIR_STORAGE_KEY, false));
  useEffect(() => {
    // 원장을 deps에 넣으면, 백필 도중 매매를 한 건만 기록해도 cleanup이 걸려
    // 그 세션에서는 다시 시작되지 않는다. 원장은 ref로만 읽는다.
    if (!isCloudPortfolioLoaded || cloudLoadFailed || fxBackfillDoneRef.current) return undefined;

    let cancelled = false;

    // 예전 버전은 과거 날짜로 입력한 거래에도 '입력한 날'의 환율을 찍었다.
    // 거래일과 기록 생성일이 다른 항목은 그 환율을 믿을 수 없으므로 한 번 다시 받아온다.
    const needsRateRepair = (entry) => {
      if (entry.currency !== 'USD' || !entry.date) return false;
      if (!(Number(entry.fxRate) > 0)) return true;
      if (fxRateRepairDoneRef.current) return false;
      const createdDate = String(entry.createdAt || '').split('T')[0];
      return Boolean(createdDate) && createdDate !== entry.date;
    };

    const backfill = async () => {
      const missing = (tradeLedgerRef.current || []).filter(needsRateRepair);
      if (missing.length === 0) {
        if (!fxRateRepairDoneRef.current) {
          fxRateRepairDoneRef.current = true;
          saveJson(FX_RATE_REPAIR_STORAGE_KEY, true);
        }
        return;
      }

      fxBackfillDoneRef.current = true;
      const uniqueDates = [...new Set(missing.map((entry) => entry.date))];
      const rateByDate = {};

      for (const date of uniqueDates) {
        if (cancelled) return;
        const rate = await fetchUsdKrwRateByDate(date);
        if (Number(rate) > 0) rateByDate[date] = Number(rate);
      }

      if (cancelled) return;
      if (Object.keys(rateByDate).length === 0) return;

      const repairIds = new Set(missing.map((entry) => String(entry.id)));
      setTradeLedger(prevLedger => prevLedger.map((entry) => {
        if (!repairIds.has(String(entry.id))) return entry;
        const rate = rateByDate[entry.date];
        return rate ? { ...entry, fxRate: rate } : entry;
      }));
      fxRateRepairDoneRef.current = true;
      saveJson(FX_RATE_REPAIR_STORAGE_KEY, true);
      addLog(`과거 거래 ${Object.keys(rateByDate).length.toLocaleString()}일치 환율을 거래일 기준으로 맞췄습니다.`, 'success');
    };

    backfill();
    return () => {
      cancelled = true;
    };
  }, [isCloudPortfolioLoaded, cloudLoadFailed]);

  const updateTargetCategoryPercent = (categoryId, percent) => {
    setTargetPortfolio(prev => ({
      ...prev,
      categories: prev.categories.map(category => (
        category.id === categoryId ? { ...category, percent: sanitizeNumericInput(percent) } : category
      )),
    }));
  };

  /**
   * 목표 비중을 손으로 100%까지 맞추기 번거로우니, 지금 넣은 값들의 비율은
   * 그대로 두고 합만 100%로 비례 배분한다. 아직 아무것도 안 넣었으면(합계 0)
   * 똑같이 나눈다.
   */
  const normalizePercentsToHundred = (entries, getPercent) => {
    if (entries.length === 0) return [];
    const total = entries.reduce((sum, entry) => sum + (Number(getPercent(entry)) || 0), 0);
    if (!(total > 0)) {
      const equalShare = Math.round((100 / entries.length) * 10) / 10;
      return entries.map(() => equalShare);
    }
    return entries.map((entry) => Math.round(((Number(getPercent(entry)) || 0) / total) * 1000) / 10);
  };

  const normalizeCategoryPercents = () => {
    setTargetPortfolio((prev) => {
      const scaled = normalizePercentsToHundred(prev.categories, (category) => category.percent);
      return {
        ...prev,
        categories: prev.categories.map((category, index) => ({ ...category, percent: scaled[index] })),
      };
    });
  };

  const normalizeGroupPercents = (categoryId) => {
    setTargetPortfolio((prev) => {
      const groups = getTargetGroups(prev, categoryId);
      const scaled = normalizePercentsToHundred(groups, (group) => group.percent);
      return {
        ...prev,
        groups: {
          ...prev.groups,
          [categoryId]: groups.map((group, index) => ({ ...group, percent: scaled[index] })),
        },
      };
    });
  };

  const normalizeItemPercents = (categoryId, groupId) => {
    setTargetPortfolio((prev) => {
      const groups = getTargetGroups(prev, categoryId);
      const targetGroup = groups.find((group) => group.id === groupId);
      if (!targetGroup) return prev;
      const items = targetGroup.items || [];
      const scaled = normalizePercentsToHundred(items, (item) => item.percent);
      return {
        ...prev,
        groups: {
          ...prev.groups,
          [categoryId]: groups.map((group) => (
            group.id === groupId
              ? { ...group, items: items.map((item, index) => ({ ...item, percent: scaled[index] })) }
              : group
          )),
        },
      };
    });
  };

  const addTargetCategory = () => {
    if (!isPortfolioAssetCategory(targetCategoryDraft)) return;
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
    ledgerId = '',
    action,
    quantity,
    price,
    date,
    memo,
    realizedPnl = 0,
    grossPnl = null,
    brokerId = '',
    brokerName = '',
    brokerFeeRate = 0,
    brokerFeeRatePercent = 0,
    brokerFee = 0,
    sellTaxRatePercent = 0,
    sellTax = 0,
    buyFeeApplied = null,
  }) => {
    const normalizedMemo = memo?.trim() || '';
    if (!normalizedMemo) return;

    setMemos(prevMemos => [{
      id: Date.now() + Math.random(),
      assetId: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      category: asset.category,
      currency: asset.currency,
      round: getTradeRound(asset),
      side: action === '매도' ? 'sell' : 'buy',
      action,
      quantity,
      price,
      date,
      pnl: realizedPnl,
      grossPnl: Number(grossPnl ?? realizedPnl) || 0,
      brokerId,
      brokerName,
      brokerFeeRate: Number(brokerFeeRate) || 0,
      brokerFeeRatePercent: Number(brokerFeeRatePercent) || 0,
      brokerFee: Number(brokerFee) || 0,
      sellTaxRatePercent: Number(sellTaxRatePercent) || 0,
      sellTax: Number(sellTax) || 0,
      // 원장을 통째로 다시 만들 때(buildInitialTradeLedger) 이 값이 없으면
      // 과거 매도의 매수 수수료 반영분이 0으로 초기화된다.
      ...(buyFeeApplied === null || buyFeeApplied === undefined
        ? {}
        : { buyFeeApplied: Number(buyFeeApplied) || 0 }),
      ledgerId,
      memo: normalizedMemo,
      createdAt: new Date().toISOString()
    }, ...prevMemos]);
  };

  const handleAddManualMemo = () => {
    if (!manualMemo.stockName || !manualMemo.date) {
      addLog('주식명과 날짜를 입력해주세요.', 'error');
      return;
    }

    const matchedAsset = resolveManualTradeAsset(manualMemo, assets);
    const manualMemoAsset = {
      id: matchedAsset?.id ?? null,
      name: manualMemo.stockName,
      ticker: matchedAsset?.ticker || manualMemo.ticker,
      category: matchedAsset?.category || '',
      currency: matchedAsset?.currency || manualMemo.currency,
    };
    const memoId = Date.now() + Math.random();
    const ledgerId = `memo-${memoId}`;
    setMemos(prevMemos => [{
      id: memoId,
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
      ledgerId,
      memo: manualMemo.memo.trim(),
      createdAt: new Date().toISOString()
    }, ...prevMemos]);
    addLedgerEntry({
      sourceId: ledgerId,
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
    setIsManualTradeEntryOpen(false);
    addLog('누락 매매 기록을 추가했습니다.', 'success');
  };

  const openAddBuyModal = (asset) => {
  setSelectedAssetToUpdate(asset);
  setAddBuyForm({
    ...initialAddBuyState,
    buyDate: formatKoreanDate(),
    brokerId: preferredBrokerId,
    brokerFeeRate: formatFeeRateInput(getBrokerFeeRatePercent(preferredBrokerId, asset.category)),
  });
  setIsUpdatingAsset(true);
};

  const openAddAssetModal = () => {
  setNewAsset({
    ...initialAssetState,
    brokerId: preferredBrokerId,
    brokerFeeRate: formatFeeRateInput(
      getBrokerFeeRatePercent(preferredBrokerId, initialAssetState.category),
    ),
  });
  setIsAdding(true);
};

  const openSellModal = (asset) => {
  const defaultBrokerId = preferredBrokerId;
  const sellDate = formatKoreanDate();
  setSelectedAssetToSell(asset);
  setSellForm({
    ...initialSellFormState,
    sellDate,
    brokerId: defaultBrokerId,
    brokerFeeRate: formatFeeRateInput(getBrokerFeeRatePercent(defaultBrokerId, asset.category)),
    sellTaxRate: formatFeeRateInput(getSellTaxRatePercent(asset, sellDate)),
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
    // 이 매수 건에 실제로 적용된 환율. 0이면 아직 못 받아온 상태다.
    fxRate: Number(row.fxRate) > 0 ? Number(row.fxRate) : 0,
    /**
     * 유관기관제비용 요율은 체결된 시장·세션에 따라 건마다 다르다.
     * 요율을 들고 다니며 다시 계산하면 증권사가 실제로 뗀 금액과 어긋나므로,
     * 증권사 화면에 찍힌 수수료 금액을 그대로 들고 다닌다.
     */
    brokerFee: Number(row.brokerFee) || 0,
  }));
};

  const openBuyLotsModal = (asset) => {
  setSelectedAssetToManageBuys(asset);
  setBuyLotDrafts(buildBuyLotDrafts(asset));
  setAccountTypeDraft(normalizeAccountType(asset.accountType));
  setManualPurchaseKrwDraft(
    parseNumber(asset.manualPurchaseKRW) > 0
      ? formatInputNumber(String(Math.round(parseNumber(asset.manualPurchaseKRW))))
      : ''
  );
};

  const closeBuyLotsModal = () => {
  setSelectedAssetToManageBuys(null);
  setBuyLotDrafts([]);
  setAccountTypeDraft(ACCOUNT_TYPE_GENERAL);
  setManualPurchaseKrwDraft('');
};

  const updateBuyLotDraft = (draftId, field, value) => {
  setBuyLotDrafts(prevDrafts => prevDrafts.map(lot => (
    lot.draftId === draftId ? editBuyLot(lot, field, value) : lot
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
      fxRate: 0,
      brokerFee: 0,
    },
  ]);
};

  const removeBuyLotDraft = (draftId) => {
  setBuyLotDrafts(prevDrafts => prevDrafts.filter(lot => lot.draftId !== draftId));
};

  const getBuyDateFxKey = (currency, date) => `${currency || ''}::${date || ''}`;
  const getBuyDateFxState = (currency, date) => {
    if (!currency || currency === 'KRW') return { rate: 1, status: 'ready' };
    if (!date) return { rate: 0, status: 'idle' };
    return buyDateFxRates[getBuyDateFxKey(currency, date)] || { rate: 0, status: 'idle' };
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
  const hasUnresolvedChangedDate = normalizedDrafts.some((lot) => {
    const existingRow = existingBuyRowsById.get(String(lot.ledgerId));
    if (existingRow && getRecordDate(existingRow) === lot.date) return false;
    return resolveBuyLotFxRate({
      lot, existingRow, currency: selectedAssetToManageBuys.currency,
      lookedUpRate: getBuyDateFxState(selectedAssetToManageBuys.currency, lot.date).rate,
    }) <= 0;
  });
  if (hasUnresolvedChangedDate) {
    addLog('변경한 매수일의 환율을 확인하지 못했습니다. 조회 완료 후 다시 저장해 주세요.', 'error');
    return;
  }
  const sortedDrafts = [...normalizedDrafts].sort((a, b) => (
    getDateTimestampSeconds(a.date) - getDateTimestampSeconds(b.date)
  ));
  const nextBuyRows = sortedDrafts.map((lot, index) => {
    const existingRow = lot.ledgerId ? existingBuyRowsById.get(String(lot.ledgerId)) : null;
    const fxRate = resolveBuyLotFxRate({
      lot, existingRow, currency: selectedAssetToManageBuys.currency,
      lookedUpRate: getBuyDateFxState(selectedAssetToManageBuys.currency, lot.date).rate,
    });

    return {
      ...(existingRow || {}),
      id: existingRow?.id || `buy-${selectedAssetToManageBuys.id}-${Date.now()}-${index}`,
      sourceId: existingRow?.sourceId || lot.sourceId || undefined,
      assetId: selectedAssetToManageBuys.id,
      name: selectedAssetToManageBuys.name,
      ticker: selectedAssetToManageBuys.ticker || '',
      category: selectedAssetToManageBuys.category || '',
      currency: selectedAssetToManageBuys.currency || 'KRW',
      accountType: normalizeAccountType(accountTypeDraft),
      accountTypeSource: 'user',
      round: getTradeRound(selectedAssetToManageBuys),
      side: 'buy',
      action: '매수',
      quantity: lot.quantity,
      price: lot.price,
      date: lot.date,
      fxRate,
      pnl: 0,
      // 입력한 수수료 금액을 그대로 남기고, 요율은 그 금액에서 역산한다.
      brokerFee: roundTradeCost(parseNumber(lot.brokerFee), selectedAssetToManageBuys.currency),
      brokerFeeRatePercent: deriveFeeRatePercent(
        parseNumber(lot.brokerFee), lot.quantity * lot.price,
      ),
      brokerFeeRate: deriveFeeRatePercent(
        parseNumber(lot.brokerFee), lot.quantity * lot.price,
      ) / 100,
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
  // 원금 수동 입력값은 원장 재계산과 별개로 자산에 직접 붙여 둔다. 비우면 자동 계산으로 돌아간다.
  const manualPurchaseKRW = parseNumber(manualPurchaseKrwDraft);
  // 원금 칸을 그대로 두고 매수 수량만 고친 경우, 예전 총액이 그대로 남아 원금이
  // 부풀려졌다. 사용자가 원금을 직접 건드리지 않았다면 원장 재계산 결과를 따른다.
  const openedManualPurchaseKRW = Math.round(parseNumber(selectedAssetToManageBuys.manualPurchaseKRW));
  const keepsOpenedManualPurchase = Math.abs(manualPurchaseKRW - openedManualPurchaseKRW) <= 1;
  const manageIdentity = getAssetIdentity(selectedAssetToManageBuys);
  setAssets(prevAssets => reconcileAssetsWithTradeLedger(mergeUniqueAssets(prevAssets), nextLedger).map((asset) => {
    if (asset.id !== selectedAssetToManageBuys.id && getAssetIdentity(asset) !== manageIdentity) return asset;
    const reconciledManualPurchaseKRW = parseNumber(asset.manualPurchaseKRW);
    const nextManualPurchaseKRW = keepsOpenedManualPurchase
      ? reconciledManualPurchaseKRW
      : manualPurchaseKRW;
    return {
      ...asset,
      accountType: normalizeAccountType(accountTypeDraft),
      accountTypeSource: 'user',
      manualPurchaseKRW: nextManualPurchaseKRW > 0 ? nextManualPurchaseKRW : null,
      updatedAt: new Date().toISOString(),
    };
  }));
  setMemos(prevMemos => {
    // 메모는 원장 행 id로 짝지어야 한다. 배열 인덱스로 맞추면 메모가 없는 매수 건이
    // 섞였을 때 앞뒤가 밀려서 다른 매수 건에 남의 메모가 옮겨 붙는다.
    const memoByLedgerId = new Map();
    existingBuyRows.forEach((row) => {
      const matched = findMatchingMemoForLedger(row, prevMemos);
      if (matched) memoByLedgerId.set(String(row.id), matched);
    });

    const reusedMemoIds = new Set();
    const nextBuyMemos = nextBuyRows.map((row, index) => {
      const existingMemo = memoByLedgerId.get(String(row.id)) || null;
      if (existingMemo) reusedMemoIds.add(existingMemo.id);

      return {
        ...(existingMemo || {}),
        id: existingMemo?.id || Date.now() + Math.random() + index,
        assetId: selectedAssetToManageBuys.id,
        name: selectedAssetToManageBuys.name,
        ticker: selectedAssetToManageBuys.ticker || '',
        category: selectedAssetToManageBuys.category || '',
        currency: selectedAssetToManageBuys.currency || 'KRW',
        accountType: normalizeAccountType(accountTypeDraft),
        accountTypeSource: 'user',
        round: getTradeRound(selectedAssetToManageBuys),
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

    // 실제로 이어붙인 메모만 교체한다. 매수 건이 줄어 짝을 잃은 메모는 지우지 않고
    // 남겨서, 과거 매매 기록에 '미연결 기록'으로 보이게 한다(내용 소실 방지).
    return [
      ...nextBuyMemos,
      ...prevMemos.filter(memo => !reusedMemoIds.has(memo.id)),
    ];
  });

  addLog(`'${selectedAssetToManageBuys.name}' 매수 기록을 저장했습니다.`, 'success');
  closeBuyLotsModal();
};

  const handleAddBuyToAsset = () => {
  if (!selectedAssetToUpdate) return;

  const addedQty = parseNumber(addBuyForm.quantity);
  const enteredPrice = parseNumber(addBuyForm.averagePrice);
  const selectedAssetIdentity = getAssetIdentity(selectedAssetToUpdate);
  const updatedAt = new Date().toISOString();

  if (isNaN(addedQty) || addedQty <= 0) {
    addLog("추가 매수 수량을 올바르게 입력해주세요.", "error");
    return;
  }

  if (isNaN(enteredPrice) || enteredPrice <= 0) {
    addLog("추가 매수 단가를 올바르게 입력해주세요.", "error");
    return;
  }

  // 원화로 입력했다면 매수일 환율로 현지 통화 단가를 되돌린다. (자산 추가와 같은 규칙)
  const addBuyCurrency = selectedAssetToUpdate.currency || 'KRW';
  const isKrwPriceInput = addBuyCurrency !== 'KRW' && addBuyForm.priceInputCurrency === 'KRW';
  const addBuyFx = getBuyDateFxState(addBuyCurrency, addBuyForm.buyDate);

  if (isKrwPriceInput && !(addBuyFx.rate > 0)) {
    addLog(
      addBuyFx.status === 'loading'
        ? '매수일 환율을 받아오는 중입니다. 잠시 후 다시 눌러주세요.'
        : '매수일 환율을 받아오지 못했습니다. 달러로 입력하거나 매수일을 확인해주세요.',
      'error',
    );
    return;
  }

  const appliedFxRate = isKrwPriceInput ? addBuyFx.rate : 0;
  const addedAvgNative = isKrwPriceInput ? enteredPrice / appliedFxRate : enteredPrice;
  const addedPurchaseKRW = isKrwPriceInput ? enteredPrice * addedQty : 0;
  const addBuyBrokerId = addBuyForm.brokerId || DEFAULT_BROKER_ID;
  const addBuyBrokerPreset = getBrokerPreset(addBuyBrokerId);
  const addBuyBrokerFee = calculateBuyFee(addBuyForm, addedQty, addedAvgNative, addBuyCurrency, {
    feeKrwRate: appliedFxRate,
  });
  const addBuyFeeRatePercent = deriveFeeRatePercent(addBuyBrokerFee, addedQty * addedAvgNative);

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

      // 기존 원금도 직접 확정돼 있을 때만 더한다. 아니면 자동 계산으로 되돌린다.
      const existingManual = parseNumber(asset.manualPurchaseKRW);
      const nextManualPurchaseKRW = (existingManual > 0 && addedPurchaseKRW > 0)
        ? existingManual + addedPurchaseKRW
        : (existingManual > 0 ? null : asset.manualPurchaseKRW ?? null);

      return {
        ...asset,
        quantity: totalQty,
        averagePrice: nextOriginalAveragePrice,
        originalAveragePrice: nextOriginalAveragePrice,
        manualPurchaseKRW: nextManualPurchaseKRW,
        buyDate: nextBuyDate,
        updatedAt,
      };
    }))
  );

  const ledgerId = `buy-${Date.now()}-${Math.random()}`;
  const addBuyCostFields = {
    brokerId: addBuyBrokerId,
    brokerName: addBuyBrokerPreset.name,
    brokerFeeRate: addBuyFeeRatePercent / 100,
    brokerFeeRatePercent: addBuyFeeRatePercent,
    brokerFee: addBuyBrokerFee,
  };
  addTradeMemo({
    asset: selectedAssetToUpdate,
    ledgerId,
    action: '매수',
    quantity: addedQty,
    price: addedAvgNative,
    date: addBuyForm.buyDate,
    memo: addBuyForm.memo,
    ...addBuyCostFields,
  });
  addLedgerEntry({
    sourceId: ledgerId,
    asset: selectedAssetToUpdate,
    side: 'buy',
    quantity: addedQty,
    price: addedAvgNative,
    date: addBuyForm.buyDate,
    fxRate: appliedFxRate,
    ...addBuyCostFields,
  });
  setPreferredBrokerId(addBuyBrokerId);

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
  const brokerId = sellForm.brokerId || DEFAULT_BROKER_ID;
  const brokerPreset = getBrokerPreset(brokerId);
  const sellTaxRatePercent = parseNumber(sellForm.sellTaxRate);
  const sellCosts = calculateSellCosts({
    brokerFeeAmount: sellForm.feeMode === 'amount' ? sellForm.brokerFeeAmount : null,
    brokerFeeRatePercent: parseNumber(sellForm.brokerFeeRate),
    category: selectedAssetToSell.category,
    currency: selectedAssetToSell.currency,
    quantity: sellQty,
    sellPrice: sellPriceNative,
    buyPrice: avgBuyNative,
    sellTaxRatePercent,
  });
  // 금액으로 입력했으면 요율은 역산값을 기록에 남긴다.
  const brokerFeeRatePercent = sellCosts.feeRatePercent;
  const brokerFeeRate = brokerFeeRatePercent / 100;
  const brokerFeeNative = sellCosts.brokerFee;
  const sellTaxNative = sellCosts.sellTax;
  const grossPnlNative = sellCosts.grossPnl;
  // 이번에 파는 수량에 붙어 있던 매수 수수료도 실현손익에서 뺀다(증권사 화면과 같은 기준).
  const buyFeeAppliedNative = getSellBuyFeeShare(selectedAssetToSell, sellQty);
  const pnlNative = sellCosts.netPnl - buyFeeAppliedNative;
  const selectedAssetIdentity = getAssetIdentity(selectedAssetToSell);
  const updatedAt = new Date().toISOString();

  const trade = {
    id: Date.now(),
    name: selectedAssetToSell.name,
    ticker: selectedAssetToSell.ticker,
    category: selectedAssetToSell.category,
    currency: selectedAssetToSell.currency,
    round: getTradeRound(selectedAssetToSell),
    buyDate: selectedAssetToSell.buyDate,
    sellDate: sellForm.sellDate,
    buyPrice: avgBuyNative,
    sellPrice: sellPriceNative,
    quantity: sellQty,
    pnl: pnlNative,
    grossPnl: grossPnlNative,
    brokerId,
    brokerName: brokerPreset.name,
    brokerFeeRate,
    brokerFeeRatePercent,
    brokerFee: brokerFeeNative,
    sellTaxRatePercent,
    sellTax: sellTaxNative,
    // 이 매도에 반영된 매수 수수료. brokerFee(매도 수수료)와 섞이지 않게 따로 남긴다.
    buyFeeApplied: buyFeeAppliedNative,
  };

  // 소수점 주식은 0.1 + 0.2처럼 저장된 수량을 전량 매도해도 5e-17이 남는다.
  // === 0으로 보면 그 종목이 지워지지 않고 먼지 같은 수량으로 계속 남는다.
  const remainingQty = Math.abs(currentQty - sellQty) <= QUANTITY_EPSILON
    ? 0
    : currentQty - sellQty;

  setTrades(prev => [trade, ...prev]);

  if (remainingQty === 0) {
    setAssets(prev => prev.filter(asset => (
      asset.id !== selectedAssetToSell.id && getAssetIdentity(asset) !== selectedAssetIdentity
    )));
  } else {
    setAssets(prev =>
      mergeUniqueAssets(prev.map(asset =>
        asset.id === selectedAssetToSell.id || getAssetIdentity(asset) === selectedAssetIdentity
          ? {
            ...asset,
            quantity: remainingQty,
            // 확정 원금은 총액이라 수량만 줄이면 남은 보유분의 원금과
            // 원화 평단가가 그대로 남아 수익률이 통째로 부풀려진다.
            manualPurchaseKRW: scaleManualPurchaseKRW(
              asset.manualPurchaseKRW,
              parseNumber(asset.quantity),
              remainingQty,
            ),
            updatedAt,
          }
          : asset
      ))
    );
  }

  const ledgerId = `trade-${trade.id}`;
  addTradeMemo({
    asset: selectedAssetToSell,
    ledgerId,
    action: '매도',
    quantity: sellQty,
    price: sellPriceNative,
    date: sellForm.sellDate,
    memo: sellForm.memo,
    realizedPnl: pnlNative,
    grossPnl: grossPnlNative,
    brokerId,
    brokerName: brokerPreset.name,
    brokerFeeRate,
    brokerFeeRatePercent,
    brokerFee: brokerFeeNative,
    sellTaxRatePercent,
    sellTax: sellTaxNative,
    buyFeeApplied: buyFeeAppliedNative,
  });
  addLedgerEntry({
    sourceId: ledgerId,
    asset: selectedAssetToSell,
    side: 'sell',
    quantity: sellQty,
    price: sellPriceNative,
    date: sellForm.sellDate,
    pnl: pnlNative,
    grossPnl: grossPnlNative,
    brokerId,
    brokerName: brokerPreset.name,
    brokerFeeRate,
    brokerFeeRatePercent,
    brokerFee: brokerFeeNative,
    sellTaxRatePercent,
    sellTax: sellTaxNative,
    buyFeeApplied: buyFeeAppliedNative,
  });

  setPreferredBrokerId(brokerId);
  addLog(`'${selectedAssetToSell.name}' 매도 반영 완료`, "success");
  setIsSellingAsset(false);
  setSelectedAssetToSell(null);
  setSellForm(initialSellFormState);

};

  const openActualDividendForm = () => {
    const firstAsset = dividendEntryAssets[0];
    setActualDividendForm({
      assetId: firstAsset ? String(firstAsset.id) : '',
      name: firstAsset?.name || '',
      ticker: firstAsset?.ticker || '',
      category: firstAsset?.category || '국내주식',
      date: defaultBuyDate,
      amount: '',
      quantity: firstAsset?.quantity || '',
      currency: firstAsset?.currency || 'KRW',
    });
    setIsAddingDividend(true);
  };

  const handleActualDividendAssetChange = (assetId) => {
    const asset = dividendEntryAssets.find((candidate) => String(candidate.id) === String(assetId));
    setActualDividendForm((previous) => ({
      ...previous,
      assetId,
      name: assetId === '__manual__' ? '' : asset?.name || previous.name,
      ticker: assetId === '__manual__' ? '' : asset?.ticker || previous.ticker,
      category: assetId === '__manual__'
        ? (previous.currency === 'KRW' ? '국내주식' : '해외주식')
        : asset?.category || previous.category,
      quantity: asset?.quantity || '',
      currency: asset?.currency || previous.currency,
    }));
  };

  const handleAddActualDividend = () => {
    const selectedAsset = dividendEntryAssets.find((candidate) => (
      String(candidate.id) === String(actualDividendForm.assetId)
    ));
    const manualName = String(actualDividendForm.name || actualDividendForm.ticker || '').trim();
    const asset = selectedAsset || (actualDividendForm.assetId === '__manual__' && manualName ? {
      id: `manual-dividend-${String(actualDividendForm.ticker || manualName).trim().toUpperCase()}`,
      name: manualName,
      ticker: String(actualDividendForm.ticker || '').trim().toUpperCase(),
      category: actualDividendForm.category || (actualDividendForm.currency === 'KRW' ? '국내주식' : '해외주식'),
      currency: actualDividendForm.currency || 'KRW',
    } : null);
    const amount = parseNumber(actualDividendForm.amount);
    const quantity = parseNumber(actualDividendForm.quantity);
    if (!asset || !actualDividendForm.date || amount <= 0) {
      addLog('종목·입금일·실제 입금액을 확인해주세요.', 'error');
      return;
    }

    const dividend = {
      id: `actual-${Date.now()}`,
      assetId: asset.id,
      name: asset.name,
      ticker: asset.ticker || '',
      category: asset.category || '',
      currency: actualDividendForm.currency || asset.currency || 'KRW',
      quantity: quantity > 0 ? quantity : undefined,
      perShareNetAmount: quantity > 0 ? amount / quantity : undefined,
      amount,
      date: actualDividendForm.date,
      actualPaymentDate: actualDividendForm.date,
      period: actualDividendForm.date.slice(0, 7),
      dateBasis: 'payment',
      status: 'actual',
      recordType: 'actual',
      confirmationSource: 'user-entry',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setConfirmedDividends((previous) => mergeUniqueDividends([dividend], previous));
    setIsAddingDividend(false);
    addLog(`'${asset.name}' 실제 입금 배당을 반영했습니다.`, 'success');
  };

  const handleConfirmedDividendImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const sourceRows = parsed?.data?.confirmedDividends || parsed?.confirmedDividends;
      if (!Array.isArray(sourceRows)) throw new Error('confirmedDividends array not found');

      const validRows = sourceRows.filter((row) => (
        row
        && row.name
        && row.currency
        && Number(row.amount) >= 0
        && (row.actualPaymentDate || row.paymentDate || row.date || row.period)
      ));
      if (validRows.length === 0) throw new Error('no valid dividend records');

      setConfirmedDividends((previous) => mergeDividendRecords(validRows, previous));
      addLog(`실제 입금 배당 ${validRows.length.toLocaleString()}건을 복구 파일에서 불러왔습니다.`, 'success');
    } catch (error) {
      console.error('Confirmed dividend import failed:', error);
      addLog('실제 배당 복구 파일을 읽지 못했습니다.', 'error');
    }
  };

  const removeConfirmedDividend = (dividendId) => {
    const deletedAt = new Date().toISOString();
    setConfirmedDividends((previous) => previous.map((dividend) => (
      dividend.id === dividendId
        ? { ...dividend, status: 'deleted', deletedAt, updatedAt: deletedAt }
        : dividend
    )));
    addLog('실제 입금 배당 기록을 삭제했습니다.', 'success');
  };

  // 자산 추가 처리
  /**
   * 원화로 입력한 단가를 현지 통화로 바꾸려면 "그날의 환율"이 필요하다.
   * 오늘 환율로 나누면 과거 매수건의 수량·평단이 통째로 어긋나므로
   * 매수일 환율을 받아올 때까지 저장을 막고, 받아온 값을 화면에도 보여준다.
   */

  // 원화 입력이 켜져 있는 폼들이 필요로 하는 (통화, 날짜) 조합.
  const pendingBuyDateFxLookups = useMemo(() => {
    const lookups = [];
    const push = (currency, date) => {
      if (!currency || currency === 'KRW' || !date) return;
      lookups.push({ currency, date });
    };

    if (isAdding && newAsset.priceInputCurrency === 'KRW') {
      push(getAssetInputCurrency(newAsset.category, newAsset.ticker, newAsset.currency), newAsset.buyDate);
    }
    if (isUpdatingAsset && selectedAssetToUpdate && addBuyForm.priceInputCurrency === 'KRW') {
      push(selectedAssetToUpdate.currency, addBuyForm.buyDate);
    }
    if (selectedAssetToManageBuys && (selectedAssetToManageBuys.currency || 'KRW') !== 'KRW') {
      buyLotDrafts.forEach((lot) => {
        if (Number(lot.fxRate) > 0) return;
        push(selectedAssetToManageBuys.currency, lot.date);
      });
    }

    return lookups;
  }, [
    isAdding, newAsset.priceInputCurrency, newAsset.category, newAsset.ticker,
    newAsset.currency, newAsset.buyDate,
    isUpdatingAsset, selectedAssetToUpdate, addBuyForm.priceInputCurrency, addBuyForm.buyDate,
    selectedAssetToManageBuys, buyLotDrafts,
  ]);

  useEffect(() => {
    pendingBuyDateFxLookups.forEach(({ currency, date }) => {
      const key = getBuyDateFxKey(currency, date);
      const cached = buyDateFxRatesRef.current[key];
      if (cached && (cached.status === 'loading' || cached.status === 'ready')) return;
      buyDateFxRatesRef.current[key] = { rate: 0, status: 'loading' };
      setBuyDateFxRates(prev => ({ ...prev, [key]: { rate: 0, status: 'loading' } }));
      fetchKrwRateByDate(currency, date).then((rate) => {
        const result = Number(rate) > 0
          ? { rate: Number(rate), status: 'ready' }
          : { rate: 0, status: 'error' };
        buyDateFxRatesRef.current[key] = result;
        setBuyDateFxRates(prev => ({ ...prev, [key]: result }));
      }).catch(() => {
        const result = { rate: 0, status: 'error' };
        buyDateFxRatesRef.current[key] = result;
        setBuyDateFxRates(prev => ({ ...prev, [key]: result }));
      });
    });
  }, [pendingBuyDateFxLookups]);

  const handleAddAsset = () => {
    if (!newAsset.name || !newAsset.quantity || !newAsset.averagePrice) return;
    
    const ticker = normalizeInputTicker(newAsset.ticker);
    const assetCurrency = getAssetInputCurrency(newAsset.category, ticker, newAsset.currency);
    const parsedQty = parseNumber(newAsset.quantity);
    const enteredPrice = parseNumber(newAsset.averagePrice);

    /**
     * 해외 종목의 단가를 원화로 입력한 경우.
     * 입력값은 원화이므로 매수일 환율로 나눠 현지 통화 단가로 되돌린다.
     * 이때 사용자가 적은 원화 금액이 곧 실제 투자 원금이므로 그대로 확정해 둔다
     * (환율을 되돌리는 과정에서 생기는 소수점 오차로 원금이 흔들리지 않게).
     */
    const isKrwPriceInput = assetCurrency !== 'KRW'
      && newAsset.priceInputCurrency === 'KRW';
    const buyDateFx = getBuyDateFxState(assetCurrency, newAsset.buyDate);

    if (isKrwPriceInput && !(buyDateFx.rate > 0)) {
      addLog(
        buyDateFx.status === 'loading'
          ? '매수일 환율을 받아오는 중입니다. 잠시 후 다시 눌러주세요.'
          : '매수일 환율을 받아오지 못했습니다. 달러로 입력하거나 매수일을 확인해주세요.',
        'error',
      );
      return;
    }

    const appliedFxRate = isKrwPriceInput ? buyDateFx.rate : 0;
    const parsedAvgPrice = isKrwPriceInput ? enteredPrice / appliedFxRate : enteredPrice;
    const manualPurchaseKRW = isKrwPriceInput ? enteredPrice * parsedQty : null;
    // 매수 수수료는 현지 통화로 남긴다. 나중에 실현손익과 양도소득세 필요경비에서 뺀다.
    const buyBrokerId = newAsset.brokerId || DEFAULT_BROKER_ID;
    const buyBrokerPreset = getBrokerPreset(buyBrokerId);
    const buyBrokerFee = calculateBuyFee(newAsset, parsedQty, parsedAvgPrice, assetCurrency, {
      feeKrwRate: appliedFxRate,
    });
    // 기록된 요율이 늘 기록된 금액을 재현하게 맞춰 둔다. 그러지 않으면 나중에
    // 매수 기록 편집기가 요율로 다시 계산할 때 수수료가 통째로 튄다.
    const buyFeeRatePercent = deriveFeeRatePercent(buyBrokerFee, parsedQty * parsedAvgPrice);
    // 저장되는 averagePrice/currentPrice는 이름과 달리 '현지 통화' 단가다.
    // (원화 환산은 화면 계산에서 환율을 곱해 따로 만든다.)
    const nativeAveragePrice = parsedAvgPrice;

    // 이미 보유 중이면 그 회차에 합산(추가 매수)하고,
    // 전량 매도되어 남은 수량이 없으면 새 회차를 열어 이전 기록과 분리한다.
    const assetRound = resolveNextTradeRound({
      record: { ticker, name: newAsset.name, category: newAsset.category },
      assets,
      tradeLedger,
    });

    const asset = {
      id: Date.now(),
      name: newAsset.name,
      ticker,
      category: newAsset.category,
      currency: assetCurrency,
      accountType: normalizeAccountType(newAsset.accountType),
      accountTypeSource: 'user',
      round: assetRound,
      averagePrice: nativeAveragePrice, 
      quantity: parsedQty, 
      currentPrice: nativeAveragePrice, 
      originalCurrency: assetCurrency, 
      originalAveragePrice: parsedAvgPrice, 
      originalCurrentPrice: parsedAvgPrice, 
      manualPurchaseKRW,
      buyDate: newAsset.buyDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      color: getCategoryDetailColor(newAsset.category, assets.filter(asset => asset.category === newAsset.category).length)
    };

    // 같은 회차가 이미 있으면(= 보유 중인 종목을 또 추가한 경우) 평단가를 합산한다.
    // 회차가 새로 열렸다면 아래 find는 비어 있으므로 별도 자산으로 추가된다.
    setAssets(prevAssets => {
      const assetIdentity = getAssetIdentity(asset);
      const existing = prevAssets.find(candidate => getAssetIdentity(candidate) === assetIdentity);
      if (!existing) return mergeUniqueAssets([...prevAssets, asset]);

      const oldQty = parseNumber(existing.quantity);
      const oldAvg = parseNumber(existing.originalAveragePrice || existing.averagePrice);
      const totalQty = oldQty + parsedQty;
      const mergedAvg = totalQty > 0
        ? ((oldQty * oldAvg) + (parsedQty * parsedAvgPrice)) / totalQty
        : parsedAvgPrice;

      // 원금을 직접 확정한 매수끼리만 합산한다.
      // 한쪽이라도 자동 계산이면 합계가 반쪽짜리가 되므로 자동으로 되돌린다.
      const existingManual = parseNumber(existing.manualPurchaseKRW);
      const mergedManualPurchaseKRW = (existingManual > 0 && manualPurchaseKRW > 0)
        ? existingManual + manualPurchaseKRW
        : null;

      return mergeUniqueAssets(prevAssets.map(candidate => (
        getAssetIdentity(candidate) === assetIdentity
          ? {
            ...candidate,
            quantity: totalQty,
            averagePrice: mergedAvg,
            originalAveragePrice: mergedAvg,
            accountType: normalizeAccountType(newAsset.accountType),
            accountTypeSource: 'user',
            manualPurchaseKRW: mergedManualPurchaseKRW,
            updatedAt: new Date().toISOString(),
          }
          : candidate
      )));
    });
    const ledgerId = `buy-${Date.now()}-${Math.random()}`;
    const buyCostFields = {
      brokerId: buyBrokerId,
      brokerName: buyBrokerPreset.name,
      brokerFeeRate: buyFeeRatePercent / 100,
      brokerFeeRatePercent: buyFeeRatePercent,
      brokerFee: buyBrokerFee,
    };
    addTradeMemo({
      asset,
      ledgerId,
      action: '매수',
      quantity: parsedQty,
      price: parsedAvgPrice,
      date: newAsset.buyDate,
      memo: newAsset.memo,
      ...buyCostFields,
    });
    addLedgerEntry({
      sourceId: ledgerId,
      asset,
      side: 'buy',
      quantity: parsedQty,
      price: parsedAvgPrice,
      date: newAsset.buyDate,
      // 원화로 입력했다면 그때 쓴 환율을 그대로 원장에 남긴다. 원금이 두 번 계산되지 않는다.
      fxRate: appliedFxRate,
      ...buyCostFields,
    });
    setPreferredBrokerId(buyBrokerId);
    setNewAsset(initialAssetState);
    setIsAdding(false);
    addLog(
      assetRound > 1
        ? `'${asset.name}' ${assetRound}차 매수로 추가됨. 이전 회차와 평단가·손익이 분리됩니다.`
        : `'${asset.name}' 자산 추가됨. 다음 동기화 때 최신가가 반영됩니다.`,
      "info",
    );

  };


  return (
    <div className="min-h-dvh bg-canvas px-4 pt-5 pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-16 text-ink relative">
      
      {/* 동기화 라이브 피드백 */}
      <SyncStatusToast syncStatus={syncStatus} />

      <div className="max-w-330 mx-auto space-y-5 md:space-y-6">
        
        {/* Header */}
        <DashboardHeader
          exchangeRate={exchangeRate}
          isFetching={isFetching}
          lastUpdated={lastUpdated}
          portfolioName={portfolioName}
          onAddAsset={openAddAssetModal}
          onPortfolioNameChange={setPortfolioName}
          onOpenUserSettings={() => setIsUserSettingsOpen(true)}
          onRefresh={() => setRefreshTrigger(t => t + 1)}
          userEmail={userEmail}
          onSignOut={handleSignOut}
        />

        <PortfolioSaveStatus sync={cloudSync} />

        {/* 탭 */}
        <TabNav activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'portfolio' && (
          <PortfolioTab
            totalConvertedKRW={totalConvertedKRW}
            totalConvertedNetProfit={totalConvertedNetProfit}
            dashboardSummary={dashboardSummary}
            dividendCurrencyParts={dividendCurrencyParts}
            portfolioAssets={portfolioAssets}
            visibleDetailAssets={visibleDetailAssets}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            currentChartData={currentChartData}
            currentCategoryKRW={currentCategoryKRW}
            currentCategoryUSD={currentCategoryUSD}
            currentCategoryTotalConverted={currentCategoryTotalConverted}
            currentCategoryProfitKRW={currentCategoryProfitKRW}
            currentCategoryProfitUSD={currentCategoryProfitUSD}
            assetCurrencyView={assetCurrencyView}
            setAssetCurrencyView={setAssetCurrencyView}
            setIsAdding={setIsAdding}
            setInsightAsset={setInsightAsset}
            openAddBuyModal={openAddBuyModal}
            openSellModal={openSellModal}
            openBuyLotsModal={openBuyLotsModal}
            requestRemoveAsset={requestRemoveAsset}
          />
        )}

        {/* 수익 및 기록 탭 */}
        {activeTab === 'history' && (
          <HistoryTab
            dashboardSummary={dashboardSummary}
            totalConvertedNetProfit={totalConvertedNetProfit}
            krwGrossProfit={krwGrossProfit}
            usdGrossProfit={usdGrossProfit}
            overseasCapitalGainsTax={overseasCapitalGainsTax}
            annualReturnYear={annualReturnYear}
            setAnnualReturnYear={setAnnualReturnYear}
            earliestAnnualYear={earliestAnnualYear}
            selectedAnnualPerformance={selectedAnnualPerformance}
            performanceSearchTerm={performanceSearchTerm}
            setPerformanceSearchTerm={setPerformanceSearchTerm}
            filteredPerformanceSummary={filteredPerformanceSummary}
            dividendFilter={dividendFilter}
            setDividendFilter={setDividendFilter}
            selectedDividendAsset={selectedDividendAsset}
            setSelectedDividendAsset={setSelectedDividendAsset}
            filteredHistory={filteredHistory}
            currentDividendSummaryGroups={currentDividendSummaryGroups}
            historicalDividendSummaryGroups={historicalDividendSummaryGroups}
            historicalDividendCount={historicalDividendCount}
            openActualDividendForm={openActualDividendForm}
            removeConfirmedDividend={removeConfirmedDividend}
            dividendImportInputRef={dividendImportInputRef}
            handleConfirmedDividendImport={handleConfirmedDividendImport}
            isFetching={isFetching}
            tradeStockFilter={tradeStockFilter}
            setTradeStockFilter={setTradeStockFilter}
            tradeStockFilterOptions={tradeStockFilterOptions}
            tradeSideFilter={tradeSideFilter}
            setTradeSideFilter={setTradeSideFilter}
            tradeSortMode={tradeSortMode}
            setTradeSortMode={setTradeSortMode}
            tradeSummary={tradeSummary}
            visibleTrades={visibleTrades}
            displayedTrades={displayedTrades}
            hasMoreTrades={hasMoreTrades}
            setTradeVisibleCount={setTradeVisibleCount}
            expandedTradeMemoId={expandedTradeMemoId}
            setExpandedTradeMemoId={setExpandedTradeMemoId}
            updateTradeRecord={updateTradeRecord}
            removeTrade={removeTrade}
            removeTradeMemo={removeTradeMemo}
            isManualTradeEntryOpen={isManualTradeEntryOpen}
            setIsManualTradeEntryOpen={setIsManualTradeEntryOpen}
            manualTradeStockOptions={manualTradeStockOptions}
            manualMemo={manualMemo}
            setManualMemo={setManualMemo}
            handleAddManualMemo={handleAddManualMemo}
          />
        )}

        {activeTab === 'target' && (
          <TargetTab
            targetPortfolio={targetPortfolio}
            setTargetPortfolio={setTargetPortfolio}
            targetBudgetKRW={targetBudgetKRW}
            totalConvertedKRW={totalConvertedKRW}
            targetViewMode={targetViewMode}
            setTargetViewMode={setTargetViewMode}
            targetCategoryDraft={targetCategoryDraft}
            setTargetCategoryDraft={setTargetCategoryDraft}
            targetCategoryTotalPercent={targetCategoryTotalPercent}
            targetGoalChartData={targetGoalChartData}
            targetCurrentChartData={targetCurrentChartData}
            targetDrilldownChartData={targetDrilldownChartData}
            targetCurrentDrilldownChartData={targetCurrentDrilldownChartData}
            targetPortfolioGuide={targetPortfolioGuide}
            selectedTargetGuide={selectedTargetGuide}
            selectedTargetGroupGuide={selectedTargetGroupGuide}
            setSelectedTargetCategory={setSelectedTargetCategory}
            setSelectedTargetGroup={setSelectedTargetGroup}
            targetPriceSyncStatus={targetPriceSyncStatus}
            addTargetCategory={addTargetCategory}
            removeTargetCategory={removeTargetCategory}
            updateTargetCategoryPercent={updateTargetCategoryPercent}
            normalizeCategoryPercents={normalizeCategoryPercents}
            addTargetGroup={addTargetGroup}
            removeTargetGroup={removeTargetGroup}
            updateTargetGroup={updateTargetGroup}
            normalizeGroupPercents={normalizeGroupPercents}
            addTargetItem={addTargetItem}
            removeTargetItem={removeTargetItem}
            updateTargetItem={updateTargetItem}
            normalizeItemPercents={normalizeItemPercents}
            annualReturnYear={annualReturnYear}
            setAnnualReturnYear={setAnnualReturnYear}
            annualPerformances={annualPerformances}
            annualPerformanceYears={annualPerformanceYears}
            selectedAnnualPerformance={selectedAnnualPerformance}
            earliestAnnualYear={earliestAnnualYear}
            includeDividendsInReturn={includeDividendsInReturn}
          />
        )}

        {activeTab === 'calendar' && (
          <CalendarTab
            calendarView={calendarView}
            setCalendarView={setCalendarView}
            calendarMonth={calendarMonth}
            setCalendarMonth={setCalendarMonth}
            dividendCalendarCells={dividendCalendarCells}
            dividendCalendarEventsByDate={dividendCalendarEventsByDate}
            dividendCalendarMonthlySummary={dividendCalendarMonthlySummary}
            selectedCalendarEvent={selectedCalendarEvent}
            setSelectedCalendarEventId={setSelectedCalendarEventId}
            expandedCalendarDate={expandedCalendarDate}
            setExpandedCalendarDate={setExpandedCalendarDate}
            expandedCalendarEvents={expandedCalendarEvents}
            annualDividendTrend={annualDividendTrend}
            annualDividendYear={annualDividendYear}
            annualDividendFxLookupDates={annualDividendFxLookupDates}
            marketCalendarKeywords={marketCalendarKeywords}
            addMarketCalendarKeyword={addMarketCalendarKeyword}
            removeMarketCalendarKeyword={removeMarketCalendarKeyword}
          />
        )}
      </div>

      {insightAsset && (
        <ModalOverlay overlayClassName="z-[135]" labelledBy="stock-insight-title" onClose={() => setInsightAsset(null)}>
          <StockInsightPanel
            asset={insightAsset}
            user={user}
            onClose={() => setInsightAsset(null)}
          />
        </ModalOverlay>
      )}

      {isUserSettingsOpen && (
        <ModalOverlay overlayClassName="z-[130]" labelledBy="user-settings-title" onClose={() => setIsUserSettingsOpen(false)}>
          <UserSettingsPanel
            theme={theme}
            onToggleTheme={toggleTheme}
            userEmail={userEmail}
            onClose={() => setIsUserSettingsOpen(false)}
          />
        </ModalOverlay>
      )}

      {isAddingDividend && (
        <DividendEntryModal
          actualDividendForm={actualDividendForm}
          setActualDividendForm={setActualDividendForm}
          dividendEntryAssets={dividendEntryAssets}
          onAssetChange={handleActualDividendAssetChange}
          onAdd={handleAddActualDividend}
          onClose={() => setIsAddingDividend(false)}
        />
      )}

      {/* 자산 추가 모달 */}
      {isAdding && (
        <AddAssetModal
          newAsset={newAsset}
          setNewAsset={setNewAsset}
          newAssetBuyFeePreview={newAssetBuyFeePreview}
          newAssetFeeCurrency={newAssetFeeCurrency}
          resolvedCurrency={getAssetInputCurrency(newAsset.category, newAsset.ticker, newAsset.currency)}
          onAddAsset={handleAddAsset}
          onClose={() => setIsAdding(false)}
        />
      )}

{/* 매수 기록 관리 모달 */}
{selectedAssetToManageBuys && (
  <ModalOverlay overlayClassName="z-[105]" labelledBy="manage-buys-title" onClose={closeBuyLotsModal}>
    <BuyLotsEditor
      asset={selectedAssetToManageBuys} drafts={buyLotDrafts} summary={buyLotDraftSummary}
      accountType={accountTypeDraft} onAccountTypeChange={setAccountTypeDraft}
      onClose={closeBuyLotsModal} onUpdate={updateBuyLotDraft} onRemove={removeBuyLotDraft}
      onAdd={addBuyLotDraft} onSave={handleSaveBuyLots}
    />
  </ModalOverlay>
)}

{/* 추가 매수 모달 */}
      {isUpdatingAsset && (
        <AddBuyModal
          asset={selectedAssetToUpdate}
          addBuyForm={addBuyForm}
          setAddBuyForm={setAddBuyForm}
          addBuyFeePreview={addBuyFeePreview}
          addBuyFeeCurrency={addBuyFeeCurrency}
          onAddBuy={handleAddBuyToAsset}
          onClose={() => { setIsUpdatingAsset(false); setSelectedAssetToUpdate(null); }}
        />
      )}

{/* 매도 모달 */}
      {isSellingAsset && (
        <SellAssetModal
          asset={selectedAssetToSell}
          sellForm={sellForm}
          setSellForm={setSellForm}
          sellFeePreview={sellFeePreview}
          sellBuyFeeShare={sellBuyFeeShare}
          onSell={handleSellAsset}
          onClose={() => { setIsSellingAsset(false); setSelectedAssetToSell(null); }}
        />
      )}

      <RemoveAssetConfirmModal
        pendingRemoval={assetPendingRemoval}
        onCancel={() => setAssetPendingRemoval(null)}
        onConfirm={confirmRemoveAsset}
      />
    </div>
  );
};

export default App;
