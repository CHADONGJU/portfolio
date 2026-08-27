import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, Minus, TrendingUp, TrendingDown, Trash2,
  PieChart as PieIcon,
  Receipt, Wallet, ArrowLeft, X, Banknote, DollarSign, ArrowRightLeft, Search, Folder, Target, CalendarDays,
  ChevronLeft, ChevronRight, NotebookPen, PlusCircle
} from 'lucide-react';
import DashboardHeader from './components/DashboardHeader';
import ModalOverlay from './components/ModalOverlay';
import UserSettingsPanel from './components/UserSettingsPanel';
import AnnualReturnGoalCard from './components/AnnualReturnGoalCard';
import AnnualReturnHistory from './components/AnnualReturnHistory';
import BrokerFeeFields from './components/BrokerFeeFields';
import AnnualDividendTrend from './components/AnnualDividendTrend';
import DividendSummaryGrid from './components/DividendSummaryGrid';
import FeatureInfo from './components/FeatureInfo';
import ManualTradeEntryForm from './components/ManualTradeEntryForm';
import StockFilterCombobox from './components/StockFilterCombobox';
import SyncStatusToast from './components/SyncStatusToast';
import TabNav from './components/TabNav';
import TradeMemoEditor from './components/TradeMemoEditor';
import { useAuth } from './context/useAuth';
import useTheme from './hooks/useTheme';
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
  MEMOS_STORAGE_KEY,
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
  fetchStockQuote,
  fetchTradingViewQuotes,
  fetchUsdKrwRate,
  fetchUsdKrwRateByDate,
} from './services/marketData';
import {
  loadPortfolioState,
  migratePortfolioState,
  saveJoinedAt,
  savePortfolioStateDiff,
  subscribePortfolioState,
} from './services/portfolioStore';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from './utils/formatters';
import {
  claimLegacyStorageKeys,
  getScopedStorageKey,
  hasStoredKey,
  loadJson,
  moveStorageScope,
  removeStoredKeys,
  saveJson,
  setStorageErrorHandler,
} from './utils/storage';
import { arePortfolioSnapshotsEquivalent } from './utils/portfolioSnapshotComparison';
import {
  buildCanonicalTradeRows,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  getTradeRecordDate,
  getTradeRound,
  reconcileAssetsWithTradeLedger,
  resolveNextTradeRound,
  scaleManualPurchaseKRW,
} from './utils/tradeReconciliation';
import {
  addMonthsClamped,
  estimateDividendIntervalMonths,
} from './utils/dividendInterval';
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
  isDomesticEtfLikeAsset,
  resolveKnownFeeAmount,
  roundTradeCost,
} from './utils/tradeCosts';
import { summarizeDividendCalendarEvents } from './utils/dividendCalendar';
import {
  buildAnnualDividendEvents,
  summarizeAnnualDividendTrend,
} from './utils/annualDividendTrend';
import { buildStockSearchOptions } from './utils/stockSearchOptions';
import {
  calculateAnnualPerformance,
  getAnnualPerformanceYears,
  upsertDailyPortfolioSnapshot,
  withCurrentPortfolioSnapshot,
} from './utils/annualPerformance';
import { calculateOverseasCapitalGainsTax } from './utils/overseasCapitalGainsTax';
import { combineTradesWithMemos } from './utils/tradeMemos';
import {
  isDeletedMemoRecord,
  selectActiveMemoRecords,
} from './utils/memoRecords';
import { getDividendRefreshState, getDividendRefreshVersion } from './utils/dividendRefresh';
import { isRecordForAsset } from './utils/assetIdentity';
import {
  calculateDividendAmounts,
  isKoreanDividendSmallWithholdingApplicable,
  KOREAN_DIVIDEND_INCOME_TAX_RATE,
  KOREAN_DIVIDEND_SMALL_WITHHOLDING_THRESHOLD,
} from './utils/dividendCalculation';
import {
  ACCOUNT_TYPE_GENERAL,
  ACCOUNT_TYPE_OPTIONS,
  getAccountTypeLabel,
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
  getDividendExDate,
  getDividendOfficialPaymentDate,
  getDividendReportingDate,
  isDividendReportingDateShifted,
} from './utils/dividendDates';
import {
  isConfirmedDividendRecord,
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
const isCommodityCategory = (category) => category?.includes('원자재');

const ASSET_CATEGORIES = ['국내주식', '해외주식', '현금', '원자재'];

const formatAssetQuantity = (quantity, category) => {
  const number = Number(quantity);
  if (!Number.isFinite(number)) return '0';

  if (category === '해외주식') {
    return number.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  }

  return number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(number) ? 0 : 3,
  });
};

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
];

// 로그인하지 않은 상태에서 쓰는 저장 영역. 계정 영역과 절대 섞이면 안 된다.
const GUEST_STORAGE_SCOPE = 'guest';

// 클라우드 저장 실패는 대부분 일시적인 네트워크 문제다. 재시도가 없으면 방금 추가한
// 자산이 이 기기에만 남고, 나중에 원격 스냅샷에 덮여 사라진다.
const CLOUD_SAVE_RETRY_DELAYS_MS = [3000, 10000, 30000];

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
const getNextEstimatedExDividendDate = (history = [], today = new Date()) => {
  const sortedDates = history
    .map((dividend) => new Date(`${dividend.date}T00:00:00`))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b - a);
  if (sortedDates.length === 0) return null;

  const intervalMonths = estimateDividendIntervalMonths(sortedDates[1], sortedDates[0]);
  let nextDate = addMonthsClamped(sortedDates[0], intervalMonths);
  const safeLimit = addMonthsClamped(today, 24);

  while (nextDate < today && nextDate < safeLimit) {
    nextDate = addMonthsClamped(nextDate, intervalMonths);
  }

  return Number.isFinite(nextDate.getTime()) ? nextDate : null;
};
/**
 * 거래 기록의 대표 날짜. utils/tradeReconciliation의 getTradeRecordDate와 반드시
 * 같은 우선순위여야 한다. 예전에는 App만 sellDate를 먼저 봐서, buyDate와 sellDate를
 * 함께 가진 레거시 기록을 화면 정렬과 원장 정렬이 서로 다르게 줄 세웠다.
 */
const getRecordDate = getTradeRecordDate;
const getRecordPnl = (record) => Number(record.pnl ?? record.realizedPnl ?? 0);
const getTradeSide = (record) => {
  if (record.side === 'buy' || record.type === 'buy') return 'buy';
  if (record.side === 'sell' || record.type === 'sell') return 'sell';
  if (record.action === '매수') return 'buy';
  if (record.action === '매도') return 'sell';
  if (record.sellDate || getRecordPnl(record) !== 0) return 'sell';
  return 'buy';
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

// 회차까지 포함한 자산 식별자.
// 같은 삼성전자라도 "1차 / 2차"는 서로 다른 자산으로 다뤄 평단가가 섞이지 않게 한다.
const getAssetIdentity = (asset) => `${asset.ticker || ''}::${asset.name || ''}#${getTradeRound(asset)}`;

/**
 * 해외 종목 단가를 달러/원화 중 어느 쪽으로 입력할지 고르는 토글.
 * 원화를 고르면 매수일 환율로 환산한 결과를 바로 아래에 보여줘서
 * "원화로 적었는데 달러로 들어갔다"는 사고를 눈으로 막는다.
 */
const getCurrencySymbol = (currency) => ({ USD: '$', JPY: '¥', KRW: '₩' }[currency] || currency);

const PriceInputCurrencyToggle = ({ nativeCurrency, value, onChange }) => (
  <div className="seg inline-flex items-center p-0.5 rounded-[10px]" role="group" aria-label="입력 통화">
    {[
      { key: 'NATIVE', label: `${getCurrencySymbol(nativeCurrency)} ${nativeCurrency}` },
      { key: 'KRW', label: '₩ 원화' },
    ].map((option) => {
      const active = (value === 'KRW' ? 'KRW' : 'NATIVE') === option.key;
      return (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={active}
          className={`seg-item px-2.5 py-1 rounded-lg text-[11px] md:text-[12px] font-bold leading-none ${
            active ? 'text-ink' : 'text-ink-mute hover:text-ink-soft'
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

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

  const categories = Array.isArray(targetPortfolio.categories) ? targetPortfolio.categories : [];
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
    targetPortfolio: pruneTargetPortfolio(snapshot.targetPortfolio),
    portfolioName: normalizePortfolioName(snapshot.portfolioName),
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
  return categoryId === '해외주식' || categoryId === '원자재' ? 'USD' : 'KRW';
};

const getAssetInputCurrency = (category, ticker = '', savedCurrency = '') => {
  if (category === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (category === '해외주식' && normalizeInputTicker(ticker).includes('.') && savedCurrency) return savedCurrency;
  if (category === '해외주식' || category === '원자재') return 'USD';
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
  if (!asset?.ticker || isCommodityCategory(asset.category)) return null;

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
  if (normalizedCategory === '원자재') return 30;
  if (normalizedCategory === '현금') return 50;
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

const emptyPortfolioSnapshot = () => ({
  portfolioName: DEFAULT_PORTFOLIO_NAME,
  assets: [],
  trades: [],
  memos: [],
  tradeLedger: [],
  autoDividends: [],
  confirmedDividends: [],
  dividendAssetRegistry: [],
  capitalFlows: [],
  portfolioSnapshots: [],
  targetPortfolio: DEFAULT_TARGET_PORTFOLIO,
});

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

  return {
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
    targetPortfolio: read(TARGET_PORTFOLIO_STORAGE_KEY, DEFAULT_TARGET_PORTFOLIO),
  };
};

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
  const [isFetching, setIsFetching] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isCloudPortfolioLoaded, setIsCloudPortfolioLoaded] = useState(!user || !db);
  const [cloudPortfolioUserId, setCloudPortfolioUserId] = useState('');
  const [cloudLoadFailed, setCloudLoadFailed] = useState(false);
  const [cloudRetryToken, setCloudRetryToken] = useState(0);
  // 연 수익률 계산의 시작점. 클라우드 문서에 이미 저장된 값을 최우선으로 쓰고,
  // 처음 보는 계정이면 Firebase 가입일(없으면 지금)로 1회만 기록한다.
  const [joinedAt, setJoinedAt] = useState('');
  const loadedUserIdRef = useRef('');
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
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthKey(new Date()));
  const [annualDividendYear, setAnnualDividendYear] = useState(() => new Date().getFullYear());
  const [annualDividendFxRates, setAnnualDividendFxRates] = useState(() => (
    loadJson(ANNUAL_DIVIDEND_FX_RATES_STORAGE_KEY, {})
  ));
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState('');
  const [expandedCalendarDate, setExpandedCalendarDate] = useState('');
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [annualReturnYear, setAnnualReturnYear] = useState(() => new Date().getFullYear());

  const [isAdding, setIsAdding] = useState(false);
  const defaultBuyDate = new Date().toISOString().split('T')[0];
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
  const [targetCategoryDraft, setTargetCategoryDraft] = useState('원자재');
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
  // 'rate'면 요율(%)로, 'amount'면 증권사 화면의 수수료 금액으로 계산한다.
  feeMode: 'rate',
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
  feeMode: 'rate',
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
 */
const calculateBuyFee = (form = {}, quantity, price, currency = 'KRW') => {
  // 금액을 직접 넣었으면 그것이 실제로 낸 돈이다. 요율보다 우선한다.
  // 다만 ₩ 모드로 바꾸기만 하고 아직 비어 있으면 요율 계산을 그대로 쓴다.
  if (form.feeMode === 'amount') {
    const known = resolveKnownFeeAmount(form.brokerFeeAmount);
    if (known !== null) return roundTradeCost(known, currency);
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
   * 단 '직접 입력'은 사용자가 적어 넣은 값이므로 절대 건드리지 않는다.
   * (예전에는 요율을 타이핑하는 순간 brokerId가 custom이 되면서 이 효과가 0으로 덮어썼다.)
   */
  useEffect(() => {
    if (!isAdding) return;
    setNewAsset((prev) => {
      if (prev.brokerId === 'custom' || prev.feeMode === 'amount') return prev;
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
    } else if (newAsset.category === '현금') {
      setNewAsset(prev => ({ ...prev, averagePrice: 1, ticker: '' }));
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

  const [assets, setAssets] = useState(() => (
    migrateUserConfirmedAccountTypes(loadJson(scopedKey(ASSETS_STORAGE_KEY), []))
  ));
  const [trades, setTrades] = useState(() => loadJson(scopedKey(TRADES_STORAGE_KEY), []));
  const [memos, setMemos] = useState(() => loadJson(scopedKey(MEMOS_STORAGE_KEY), []));
  const [tradeLedger, setTradeLedger] = useState(() => loadJson(scopedKey(TRADE_LEDGER_STORAGE_KEY), []));

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
  const [portfolioName, setPortfolioName] = useState(() => normalizePortfolioName(loadJson(scopedKey(PORTFOLIO_NAME_STORAGE_KEY), DEFAULT_PORTFOLIO_NAME)));
  const [targetPortfolio, setTargetPortfolio] = useState(() => loadJson(scopedKey(TARGET_PORTFOLIO_STORAGE_KEY), DEFAULT_TARGET_PORTFOLIO));
  const [capitalFlows, setCapitalFlows] = useState(() => loadJson(scopedKey(CAPITAL_FLOWS_STORAGE_KEY), []));
  const [portfolioSnapshots, setPortfolioSnapshots] = useState(() => loadJson(scopedKey(PORTFOLIO_SNAPSHOTS_STORAGE_KEY), []));
  const [dividendAssetRegistry, setDividendAssetRegistry] = useState(() => loadJson(scopedKey(DIVIDEND_ASSET_REGISTRY_STORAGE_KEY), []));
  // 매수·매도 모달이 공유하는 기본 증권사. 매번 고르지 않아도 되게 기억해 둔다.
  const [preferredBrokerId, setPreferredBrokerId] = useState(() => (
    getBrokerPreset(loadJson(scopedKey(PREFERRED_BROKER_STORAGE_KEY), DEFAULT_BROKER_ID)).id
  ));
  const targetPortfolioRef = useRef(targetPortfolio);
  const targetTickerSnapshotKey = useMemo(() => (
    getTargetItemSnapshotKey(targetPortfolio)
  ), [targetPortfolio]);

  const [autoDividends, setAutoDividends] = useState(() => loadJson(scopedKey(AUTO_DIVIDENDS_STORAGE_KEY), []));
  const [confirmedDividends, setConfirmedDividends] = useState(() => loadJson(scopedKey(CONFIRMED_DIVIDENDS_STORAGE_KEY), []));
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
    targetPortfolio,
  }), [portfolioName, assets, trades, memos, tradeLedger, autoDividends, confirmedDividends, dividendAssetRegistry, capitalFlows, portfolioSnapshots, targetPortfolio]);
  const portfolioSnapshotRef = useRef(portfolioSnapshot);
  const cloudSnapshotRef = useRef(null);
  const cloudRevisionRef = useRef('');
  const applyingCloudSnapshotRef = useRef(false);

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
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(PORTFOLIO_NAME_STORAGE_KEY), portfolioName);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(TARGET_PORTFOLIO_STORAGE_KEY), targetPortfolio);
  usePersistedPortfolioSlice(isStorageScopeReady, scopedKey(PREFERRED_BROKER_STORAGE_KEY), preferredBrokerId);
  useEffect(() => { targetPortfolioRef.current = targetPortfolio; }, [targetPortfolio]);
  useEffect(() => { portfolioSnapshotRef.current = portfolioSnapshot; }, [portfolioSnapshot]);

  const resetPortfolioState = () => {
    setAssets([]);
    setTrades([]);
    setMemos([]);
    setTradeLedger([]);
    setAutoDividends([]);
    setConfirmedDividends([]);
    setDividendAssetRegistry([]);
    setCapitalFlows([]);
    setPortfolioSnapshots([]);
    setPortfolioName(DEFAULT_PORTFOLIO_NAME);
    setTargetPortfolio(DEFAULT_TARGET_PORTFOLIO);
    // 이전 계정의 가입일이 남아 있으면 로그아웃/계정 전환 뒤에도 그 날짜를
    // 기준으로 연 수익률을 계산해 말도 안 되는 수익률이 뜬다.
    setJoinedAt('');
  };

  const applyStoredPortfolio = (stored) => {
    setAssets(stored.assets);
    setTrades(stored.trades);
    setMemos(stored.memos);
    setTradeLedger(stored.tradeLedger);
    setAutoDividends(stored.autoDividends);
    setConfirmedDividends(stored.confirmedDividends);
    setDividendAssetRegistry(stored.dividendAssetRegistry);
    setCapitalFlows(stored.capitalFlows);
    setPortfolioSnapshots(stored.portfolioSnapshots);
    setPortfolioName(stored.portfolioName);
    setTargetPortfolio(stored.targetPortfolio);
  };

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
    cloudSnapshotRef.current = null;
    cloudRevisionRef.current = '';
    setPersistedStorageScope(storageScope);
  }, [storageScope, persistedStorageScope]);

  const handleSignOut = async () => {
    // 로그아웃 후에도 localStorage가 남아 있으면, 같은 기기에서
    // '로그인 없이 보기'로 들어온 다음 사람에게 이전 사용자 데이터가 그대로 보인다.
    removeStoredKeys(PORTFOLIO_STORAGE_KEYS.map(key => scopedKey(key)));
    resetPortfolioState();
    setCloudPortfolioUserId('');
    setCloudLoadFailed(false);
    cloudSnapshotRef.current = null;
    cloudRevisionRef.current = '';

    try {
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
    if (!userId || !db) {
      setIsCloudPortfolioLoaded(true);
      setCloudPortfolioUserId('');
      setJoinedAt('');
      return undefined;
    }

    let cancelled = false;

    // 계정이 바뀌었는데 이전 사용자 상태가 메모리에 남아 있으면,
    // 아래 '원격 문서 없음' 경로에서 남의 데이터를 새 계정에 올려버린다.
    const previousUserId = loadedUserIdRef.current;
    const isAccountSwitch = Boolean(previousUserId) && previousUserId !== userId;
    if (isAccountSwitch) resetPortfolioState();

    const loadCloudPortfolio = async () => {
      setIsCloudPortfolioLoaded(false);
      setCloudLoadFailed(false);

      let loadSucceeded = false;

      try {
        const cloudState = await loadPortfolioState(db, userId);

        if (cancelled) return;

        const resolveJoinedAtFallback = () => {
          const creationTime = user?.metadata?.creationTime;
          const parsedCreation = creationTime ? new Date(creationTime) : null;
          return parsedCreation && Number.isFinite(parsedCreation.getTime())
            ? formatDateKey(parsedCreation)
            : formatDateKey(new Date());
        };

        if (cloudState.exists) {
          const existingJoinedAt = String(cloudState.data?.joinedAt || '').slice(0, 10);
          if (existingJoinedAt) {
            setJoinedAt(existingJoinedAt);
          } else {
            const fallbackJoinedAt = resolveJoinedAtFallback();
            setJoinedAt(fallbackJoinedAt);
            saveJoinedAt(db, userId, fallbackJoinedAt).catch((error) => {
              console.error('가입일 기록 실패:', error);
            });
          }

          const compactedData = compactPortfolioSnapshot(cloudState.data);
          const persistedCompactedData = {
            ...compactedData,
            assets: mergeUniqueAssets(Array.isArray(cloudState.data.assets) ? cloudState.data.assets : []),
          };
          const migratedAccountTypes = JSON.stringify(persistedCompactedData.assets)
            !== JSON.stringify(compactedData.assets);
          const localData = compactPortfolioSnapshot(
            (!isAccountSwitch && portfolioSnapshotRef.current) || emptyPortfolioSnapshot(),
          );
          const protectedData = {
            ...compactedData,
            autoDividends: mergeAutomaticDividendRecords(
              compactedData.autoDividends,
              localData.autoDividends,
            ),
            confirmedDividends: mergeDividendRecords(
              localData.confirmedDividends,
              compactedData.confirmedDividends,
            ),
          };
          const restoredLocalDividends = protectedData.confirmedDividends.length
            > compactedData.confirmedDividends.length;
          const restoredLocalAutoDividends = protectedData.autoDividends.length
            > compactedData.autoDividends.length;
          const removedDuplicateAutoDividends = protectedData.autoDividends.length
            < compactedData.autoDividends.length;
          if (cloudState.needsMigration) {
            await migratePortfolioState(db, userId, protectedData, userEmail);
            if (cancelled) return;
            addLog('클라우드 저장 구조를 안전하게 최신 버전으로 이전했습니다.', 'success');
          } else if (
            restoredLocalDividends
            || restoredLocalAutoDividends
            || removedDuplicateAutoDividends
            || migratedAccountTypes
          ) {
            await savePortfolioStateDiff(db, userId, protectedData, persistedCompactedData, userEmail);
            if (cancelled) return;
            addLog(
              migratedAccountTypes
                ? '확인된 계좌 유형과 배당 내역을 클라우드에 반영했습니다.'
                : '이 기기에 남아 있던 배당 내역을 클라우드에 복구했습니다.',
              'success',
            );
          }

          cloudSnapshotRef.current = protectedData;
          cloudRevisionRef.current = cloudState.revision || '';
          applyingCloudSnapshotRef.current = true;
          setAssets(protectedData.assets);
          setTrades(protectedData.trades);
          setMemos(protectedData.memos);
          setTradeLedger(protectedData.tradeLedger);
          setAutoDividends(protectedData.autoDividends);
          setConfirmedDividends(protectedData.confirmedDividends);
          setDividendAssetRegistry(protectedData.dividendAssetRegistry);
          setCapitalFlows(protectedData.capitalFlows);
          setPortfolioSnapshots(protectedData.portfolioSnapshots);
          setPortfolioName(protectedData.portfolioName);
          setTargetPortfolio(protectedData.targetPortfolio);
          addLog('로그인 계정의 저장 데이터를 불러왔습니다.', 'success');
        } else {
          // 원격 문서가 없다고 해서 로컬을 지우면, 로그인 없이 쓰던 기록이 통째로 날아간다.
          // 다만 계정을 갈아탄 경우에는 앞선 사용자의 데이터이므로 절대 올리면 안 된다.
          const localSnapshot = compactPortfolioSnapshot(
            (!isAccountSwitch && portfolioSnapshotRef.current) || emptyPortfolioSnapshot(),
          );
          const hasLocalData = (localSnapshot.assets?.length || 0) > 0
            || (localSnapshot.trades?.length || 0) > 0
            || (localSnapshot.memos?.length || 0) > 0
            || (localSnapshot.tradeLedger?.length || 0) > 0
            || (localSnapshot.capitalFlows?.length || 0) > 0
            || (localSnapshot.portfolioSnapshots?.length || 0) > 0;

          await migratePortfolioState(db, userId, localSnapshot, userEmail);
          if (cancelled) return;
          const fallbackJoinedAt = resolveJoinedAtFallback();
          setJoinedAt(fallbackJoinedAt);
          saveJoinedAt(db, userId, fallbackJoinedAt).catch((error) => {
            console.error('가입일 기록 실패:', error);
          });
          cloudSnapshotRef.current = localSnapshot;
          cloudRevisionRef.current = '';
          applyingCloudSnapshotRef.current = true;

          addLog(
            hasLocalData
              ? '이 기기에 있던 데이터를 계정에 연결했습니다.'
              : '새 포트폴리오를 시작합니다.',
            'success',
          );
        }

        loadSucceeded = true;
      } catch (error) {
        console.error('Cloud portfolio load failed:', error);
        if (!cancelled) {
          setCloudLoadFailed(true);
          addLog('클라우드 데이터를 불러오지 못했습니다. 저장이 잠시 멈춥니다.', 'error');
        }
      } finally {
        if (!cancelled) {
          setIsCloudPortfolioLoaded(true);
          // 읽기에 실패한 상태로 저장 게이트를 열면, 비어 있는 로컬 상태가
          // 원격 문서를 통째로 덮어써 복구가 불가능해진다.
          if (loadSucceeded) {
            loadedUserIdRef.current = userId;
            setCloudPortfolioUserId(userId);
          }
        }
      }
    };

    loadCloudPortfolio();
    return () => {
      cancelled = true;
    };
  }, [userId, userEmail, cloudRetryToken, user?.metadata?.creationTime]);

  useEffect(() => {
    if (!userId || !db || !isCloudPortfolioLoaded || cloudLoadFailed || cloudPortfolioUserId !== userId) {
      return undefined;
    }

    let cancelled = false;
    let isReloading = false;

    const unsubscribe = subscribePortfolioState(db, userId, async ({ exists, revision }) => {
      if (cancelled || !exists || !revision || revision === cloudRevisionRef.current || isReloading) return;
      isReloading = true;

      try {
        const cloudState = await loadPortfolioState(db, userId);
        if (cancelled || !cloudState.exists) return;

        const compactedData = compactPortfolioSnapshot(cloudState.data);
        const persistedCompactedData = {
          ...compactedData,
          assets: mergeUniqueAssets(Array.isArray(cloudState.data.assets) ? cloudState.data.assets : []),
        };
        const migratedAccountTypes = JSON.stringify(persistedCompactedData.assets)
          !== JSON.stringify(compactedData.assets);
        const currentData = compactPortfolioSnapshot(portfolioSnapshotRef.current);
        const protectedData = {
          ...compactedData,
          autoDividends: mergeAutomaticDividendRecords(
            compactedData.autoDividends,
            currentData.autoDividends,
          ),
          confirmedDividends: mergeDividendRecords(
            currentData.confirmedDividends,
            compactedData.confirmedDividends,
          ),
        };
        const restoredLocalDividends = protectedData.confirmedDividends.length
          > compactedData.confirmedDividends.length;
        const restoredLocalAutoDividends = protectedData.autoDividends.length
          > compactedData.autoDividends.length;
        const removedDuplicateAutoDividends = protectedData.autoDividends.length
          < compactedData.autoDividends.length;
        if (
          restoredLocalDividends
          || restoredLocalAutoDividends
          || removedDuplicateAutoDividends
          || migratedAccountTypes
        ) {
          await savePortfolioStateDiff(db, userId, protectedData, persistedCompactedData, userEmail);
          if (cancelled) return;
        }
        cloudSnapshotRef.current = protectedData;
        cloudRevisionRef.current = cloudState.revision || revision;

        if (arePortfolioSnapshotsEquivalent(currentData, protectedData)) return;

        applyingCloudSnapshotRef.current = true;
        setAssets(protectedData.assets);
        setTrades(protectedData.trades);
        setMemos(protectedData.memos);
        setTradeLedger(protectedData.tradeLedger);
        setAutoDividends(protectedData.autoDividends);
        setConfirmedDividends(protectedData.confirmedDividends);
        setDividendAssetRegistry(protectedData.dividendAssetRegistry);
        setCapitalFlows(protectedData.capitalFlows);
        setPortfolioSnapshots(protectedData.portfolioSnapshots);
        setPortfolioName(protectedData.portfolioName);
        setTargetPortfolio(protectedData.targetPortfolio);
        addLog('다른 기기에서 변경된 포트폴리오를 반영했습니다.', 'success');
      } catch (error) {
        console.error('Realtime cloud portfolio reload failed:', error);
      } finally {
        isReloading = false;
      }
    }, (error) => {
      // 구독이 죽으면(토큰 만료, 규칙 변경) 기기 간 동기화가 조용히 멈춘다.
      // 저장은 계속되므로, 사용자가 모른 채 두 기기가 갈라지는 게 최악이다.
      console.error('Realtime cloud portfolio subscription failed:', error);
      if (cancelled) return;
      addLogRef.current('실시간 동기화가 끊겼습니다. 다른 기기의 변경이 반영되지 않습니다.', 'error');
    });

    // 구독만 끊고 끝내면, 진행 중이던 loadPortfolioState가 나중에 resolve되면서
    // 이전 계정의 데이터를 새 계정 화면에 setState 해버린다.
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, userEmail, isCloudPortfolioLoaded, cloudLoadFailed, cloudPortfolioUserId]);

  useEffect(() => {
    if (!userId || !db || !isCloudPortfolioLoaded || cloudLoadFailed || cloudPortfolioUserId !== userId) return undefined;
    if (applyingCloudSnapshotRef.current) {
      applyingCloudSnapshotRef.current = false;
      return undefined;
    }

    let disposed = false;
    let saveTimer = null;

    const runSave = async (attempt) => {
      try {
        const compactedSnapshot = compactPortfolioSnapshot(portfolioSnapshot);
        const result = await savePortfolioStateDiff(
          db,
          userId,
          compactedSnapshot,
          cloudSnapshotRef.current,
          userEmail,
        );
        if (disposed) return;

        cloudSnapshotRef.current = compactedSnapshot;
        // 내가 쓴 리비전을 기억해두지 않으면 실시간 구독이 이 저장을 '남의 변경'으로
        // 착각해 포트폴리오 전체를 다시 내려받는다.
        if (result?.revision) cloudRevisionRef.current = result.revision;
        if (attempt > 0) addLogRef.current('클라우드 저장을 다시 시도해 성공했습니다.', 'success');
      } catch (error) {
        if (disposed) return;
        console.error('Cloud portfolio save failed:', error);

        // 규칙 위반이나 안전장치에 걸린 저장은 다시 시도해도 결과가 같다.
        const isRetryable = error?.code !== 'unsafe-portfolio-shrink'
          && error?.code !== 'permission-denied';

        if (isRetryable && attempt < CLOUD_SAVE_RETRY_DELAYS_MS.length) {
          addLogRef.current(
            `클라우드 저장에 실패했습니다. ${Math.round(CLOUD_SAVE_RETRY_DELAYS_MS[attempt] / 1000)}초 뒤 다시 시도합니다.`,
            'error',
          );
          saveTimer = setTimeout(() => runSave(attempt + 1), CLOUD_SAVE_RETRY_DELAYS_MS[attempt]);
          return;
        }

        const message = error?.code === 'unsafe-portfolio-shrink'
          ? '데이터가 비정상적으로 대량 감소해 클라우드 저장을 차단했습니다. 기존 기록은 유지됩니다.'
          : error?.code === 'permission-denied'
            ? '클라우드 저장 권한이 없습니다. Firestore 규칙을 확인해주세요.'
            : '클라우드 저장에 계속 실패했습니다. 이 기기에는 저장돼 있으니 연결을 확인해주세요.';
        addLogRef.current(message, 'error');
      }
    };

    saveTimer = setTimeout(() => runSave(0), 700);

    return () => {
      disposed = true;
      clearTimeout(saveTimer);
    };
  }, [userId, userEmail, isCloudPortfolioLoaded, cloudLoadFailed, cloudPortfolioUserId, portfolioSnapshot]);

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
      const reconciledAssets = reconcileAssetsWithTradeLedger(mergedAssets, tradeLedger);

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
          
          if (asset.category === '현금') {
            newCurrentPrice = 1; newOriginalCurrentPrice = 1;
          } else if (asset.ticker) {
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
        if (runId === liveFetchRunIdRef.current) setIsFetching(false);
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
    if (isLiveMode) interval = setInterval(fetchLiveData, AUTO_SYNC_INTERVAL_MS); 
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [isLiveMode, refreshTrigger, isCloudPortfolioLoaded]);

  const dividendEntryAssets = useMemo(() => (
    buildDividendCalculationAssets(assets, tradeLedger)
      .filter((asset) => asset.category !== '현금')
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
    totalConvertedKRW,
    currentChartData,
    subChartData,
    currentCategoryKRW,
    currentCategoryUSD,
    currentCategoryTotalConverted,
    currentCategoryProfitKRW,
    currentCategoryProfitUSD,
    canonicalTradeRows,
    krwNetProfit,
    usdNetProfit,
    totalConvertedNetProfit,
    realizedGainKrwEvents,
    stockPerformanceSummary,
    dividendSummary,
    filteredHistory,
  } = usePortfolioMetrics({
    assets,
    trades,
    tradeLedger,
    autoDividends: reportedDividends,
    receivedDividends,
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
    const todayKey = formatDateKey(new Date());
    return [...new Set(annualDividendEvents
      .filter((event) => (
        !event.isEstimated
        && event.currency === 'USD'
        && event.fxDate < todayKey
        && !(Number(event.fxRate) > 0)
        && !(Number(annualDividendFxRates[event.fxDate]) > 0)
      ))
      .map((event) => event.fxDate))]
      .sort();
  }, [annualDividendEvents, annualDividendFxRates]);
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
    resolveKrwRate: (event) => {
      if (event.currency === 'KRW') return 1;
      if (Number(event.fxRate) > 0) return Number(event.fxRate);
      if (event.currency === 'USD') {
        if (!event.isEstimated && Number(annualDividendFxRates[event.fxDate]) > 0) {
          return Number(annualDividendFxRates[event.fxDate]);
        }
        return exchangeRate || currencyRates.USD || 1350;
      }
      if (event.currency === 'JPY') return jpyKrwRate || currencyRates.JPY || 9.5;
      return currencyRates[event.currency] || 1;
    },
  }), [
    annualDividendEvents,
    annualDividendFxRates,
    currencyRates,
    exchangeRate,
    jpyKrwRate,
  ]);

  const isDomesticStockChart = selectedCategory?.includes('국내') && selectedCategory?.includes('주식');
  const isOverseasStockChart = selectedCategory?.includes('해외') && selectedCategory?.includes('주식');
  const profitTone = currentCategoryProfitKRW >= 0 ? 'text-up' : 'text-down';
  const profitBgTone = currentCategoryProfitKRW >= 0 ? 'bg-up-soft border-up-soft' : 'bg-down-soft border-down-soft';
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
    // 현금은 매입원가 개념이 없는데 분모에 들어가면 수익률이 희석된다.
    // 개별 자산 수익률도 현금을 제외해 계산하므로 전체 수익률도 기준을 맞춘다.
    const investedAssets = enhancedAssets.filter((asset) => asset.category !== '현금');

    const purchaseKRW = enhancedAssets.reduce((sum, asset) => sum + asset.purchaseKRW, 0);
    const investedPurchaseKRW = investedAssets.reduce((sum, asset) => sum + asset.purchaseKRW, 0);
    const evaluationProfitKRW = enhancedAssets.reduce((sum, asset) => sum + asset.profitKRW, 0);
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
    const dividendKRW = receivedDividends.reduce((sum, dividend) => (
      sum + (Number(dividend.amount) || 0) * getCachedKrwRate(dividend.currency, currencyRates, exchangeRate || 1350, jpyKrwRate || 9.5)
    ), 0);
    const dividendByCurrency = receivedDividends.reduce((summary, dividend) => {
      const currency = dividend.currency || 'KRW';
      summary[currency] = (summary[currency] || 0) + (Number(dividend.amount) || 0);
      return summary;
    }, {});
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
  }, [enhancedAssets, receivedDividends, exchangeRate, jpyKrwRate, currencyRates]);
  /**
   * 연 수익률(TWR)은 배당을 그 구간의 수익으로 반영한다. 배당 레코드에 지급 시점
   * 환율(fxRate)이 있으면 그 값을 쓰고, 없으면(과거 기록) 오늘 환율로 근사한다 —
   * 지금 와서 그 날의 환율을 새로 만들어내지는 않는다.
   */
  const dividendKrwEvents = useMemo(() => receivedDividends
    .map((dividend) => {
      const amount = Number(dividend.amount) || 0;
      const rate = Number(dividend.fxRate) > 0
        ? Number(dividend.fxRate)
        : getCachedKrwRate(dividend.currency, currencyRates, exchangeRate || 1350, jpyKrwRate || 9.5);
      return { date: getDividendReportingDate(dividend), amountKRW: amount * rate };
    })
    .filter((event) => event.date && event.amountKRW > 0), [receivedDividends, currencyRates, exchangeRate, jpyKrwRate]);
  /**
   * 수익률 화면은 오늘의 자동 스냅샷이 아직 영구 저장되지 않았더라도 현재
   * 총평가액으로 즉시 계산해야 한다(하루 한 번 저장을 기다리지 않는다).
   */
  const performanceSnapshots = useMemo(() => (
    isCloudPortfolioLoaded && !cloudLoadFailed && !isFetching && Number.isFinite(Number(totalConvertedKRW))
      ? withCurrentPortfolioSnapshot(portfolioSnapshots, {
        date: formatDateKey(new Date()),
        valueKRW: totalConvertedKRW,
        unrealizedProfitKRW: dashboardSummary.investedProfitKRW,
      })
      : portfolioSnapshots
  ), [
    portfolioSnapshots, totalConvertedKRW, dashboardSummary.investedProfitKRW,
    isCloudPortfolioLoaded, cloudLoadFailed, isFetching,
  ]);
  const annualPerformanceYears = useMemo(() => getAnnualPerformanceYears({
    snapshots: performanceSnapshots,
    capitalFlows,
    currentYear: new Date().getFullYear(),
  }), [performanceSnapshots, capitalFlows]);
  const annualPerformances = useMemo(() => annualPerformanceYears.map((year) => (
    calculateAnnualPerformance({
      snapshots: performanceSnapshots,
      capitalFlows,
      dividends: dividendKrwEvents,
      realizedGains: realizedGainKrwEvents,
      year,
      joinedAt,
    })
  )), [
    annualPerformanceYears, performanceSnapshots, capitalFlows,
    dividendKrwEvents, realizedGainKrwEvents, joinedAt,
  ]);
  const selectedAnnualPerformance = useMemo(() => (
    annualPerformances.find((performance) => performance.year === annualReturnYear)
    || calculateAnnualPerformance({
      snapshots: performanceSnapshots,
      capitalFlows,
      dividends: dividendKrwEvents,
      realizedGains: realizedGainKrwEvents,
      year: annualReturnYear,
      joinedAt,
    })
  ), [
    annualPerformances, annualReturnYear, performanceSnapshots, capitalFlows,
    dividendKrwEvents, realizedGainKrwEvents, joinedAt,
  ]);
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
  useEffect(() => {
    if (!isStorageScopeReady || !isCloudPortfolioLoaded || cloudLoadFailed || isFetching || !lastUpdated) return;
    if (!(Number(totalConvertedKRW) > 0)) return;

    const date = formatDateKey(new Date());
    setPortfolioSnapshots((previous) => upsertDailyPortfolioSnapshot(previous, {
      id: `snapshot-${date}`,
      date,
      valueKRW: totalConvertedKRW,
      unrealizedProfitKRW: dashboardSummary.investedProfitKRW,
      source: 'auto',
    }));
  }, [
    isStorageScopeReady, isCloudPortfolioLoaded, cloudLoadFailed, isFetching, lastUpdated,
    totalConvertedKRW, dashboardSummary.investedProfitKRW,
  ]);
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
  const dividendCalendarEvents = useMemo(() => {
    const monthPrefix = calendarMonth;
    const today = new Date();

    return dividendSummary
      .flatMap((summary) => {
        const history = Array.isArray(summary.history) ? summary.history : [];
        const asset = enhancedAssets.find(candidate => candidate.name === summary.name);
        const paymentEvents = history.map((dividend) => {
          const officialPaymentDate = getDividendOfficialPaymentDate(dividend);
          if (!officialPaymentDate) return null;

          const dateKey = getDividendReportingDate(dividend);
          if (!dateKey.startsWith(monthPrefix)) return null;

          const quantity = Number(dividend.quantity) || parseNumber(asset?.quantity);
          const grossAmount = Number(dividend.grossAmount)
            || (Number(dividend.perShareGrossAmount) || 0) * quantity;
          const netAmount = Number(dividend.amount) || 0;
          if (quantity <= 0 || (grossAmount <= 0 && netAmount <= 0)) return null;

          return {
            id: `${dividend.id || summary.name}-payment-${dateKey}`,
            date: dateKey,
            dateLabel: isDividendReportingDateShifted(dividend) ? '한국시간 지급일' : '지급일',
            officialPaymentDate,
            exDate: getDividendExDate(dividend),
            eligibilityDate: dividend.recordDate || getDividendEligibilityDate(dividend),
            name: summary.name,
            ticker: dividend.ticker || asset?.ticker || summary.ticker || summary.name,
            currency: dividend.currency || asset?.currency || summary.currency || 'KRW',
            grossAmount,
            netAmount,
            quantity,
            isEstimated: false,
          };
        }).filter(Boolean);

        const nextDate = getNextEstimatedExDividendDate(history, today);
        if (!nextDate) return paymentEvents;

        const latestDividend = history[0] || {};
        const currency = asset?.currency || summary.currency || latestDividend.currency || 'KRW';
        const exDate = formatDateKey(nextDate);
        const eligibilityDate = getDividendEligibilityDate({ exDate, currency }) || exDate;
        if (!eligibilityDate.startsWith(monthPrefix)) return paymentEvents;

        const quantity = parseNumber(asset?.quantity || latestDividend.quantity);
        const perShareGrossAmount = Number(latestDividend.perShareGrossAmount) || 0;
        const perShareNetAmount = Number(latestDividend.perShareNetAmount)
          || (Number(latestDividend.quantity) > 0 ? Number(latestDividend.amount) / Number(latestDividend.quantity) : 0);
        const grossAmount = perShareGrossAmount * quantity;
        const netAmount = perShareNetAmount * quantity || Number(summary.expectedAmount) || 0;
        const ticker = asset?.ticker || summary.ticker || summary.name;

        if (quantity <= 0 || (grossAmount <= 0 && netAmount <= 0)) return paymentEvents;

        return [...paymentEvents, {
          id: `${summary.name}-estimated-record-${eligibilityDate}`,
          date: eligibilityDate,
          dateLabel: '예상 배당기준일',
          exDate,
          eligibilityDate,
          officialPaymentDate: '',
          name: summary.name,
          ticker,
          currency,
          grossAmount,
          netAmount,
          quantity,
          isEstimated: true,
        }];
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }, [calendarMonth, dividendSummary, enhancedAssets]);
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

      return {
        ...categoryTarget,
        currentValue,
        targetValue,
        gapValue: targetValue - currentValue,
        currentPercent: targetBudgetKRW > 0 ? (currentValue / targetBudgetKRW) * 100 : 0,
        groupTotalPercent,
        groups: enrichedGroups,
        // 목표 계획(폴더·종목)에 하나도 안 걸린 보유 자산. 팔아야 할지 계획에
        // 추가해야 할지는 사용자가 판단하되, 최소한 눈에는 보이게 한다.
        unassignedAssets,
        unassignedValue: unassignedAssets.reduce((sum, asset) => sum + asset.currentKRW, 0),
      };
    });
  }, [targetPortfolio, enhancedAssets, targetBudgetKRW, exchangeRate, jpyKrwRate, currencyRates]);
  // 매수·매도 필요 종목이 폴더 안에 하나씩 흩어져 있으면 전체 실행 계획을 보려고
  // 표 전체를 스크롤해야 한다. 금액이 큰 순서로 한곳에 모아 바로 실행할 수 있게 한다.
  const targetRebalancePlan = useMemo(() => {
    const actions = [];
    targetPortfolioGuide.forEach((category) => {
      category.groups.forEach((group) => {
        group.items.forEach((item) => {
          if (item.adjustmentSide === 'hold' || !(Math.abs(item.gapValue) > 1)) return;
          actions.push({
            key: `${category.id}-${group.id}-${item.id}`,
            categoryId: category.id,
            groupName: group.name,
            name: item.name || item.ticker || '이름 없음',
            ticker: item.ticker,
            side: item.adjustmentSide,
            amountKRW: Math.abs(item.gapValue),
            quantity: item.adjustmentQuantity,
            currency: item.currency,
            isMatched: item.isMatched,
          });
        });
      });
    });
    return {
      buys: actions.filter((action) => action.side === 'buy').sort((a, b) => b.amountKRW - a.amountKRW),
      sells: actions.filter((action) => action.side === 'sell').sort((a, b) => b.amountKRW - a.amountKRW),
    };
  }, [targetPortfolioGuide]);
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
    const canonicalRows = buildCanonicalTradeRows({ tradeLedger, trades });
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
      hasLinkedMemo
        ? '매매 기록과 연결된 메모를 함께 삭제했습니다.'
        : '매매 기록이 삭제되었습니다.',
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

  const updateTradeMemo = (record, memoText) => {
    const normalizedMemo = memoText.trim();
    if (!normalizedMemo) return;
    const updatedAt = new Date().toISOString();

    if (record.memoRecordId !== null && record.memoRecordId !== undefined) {
      setMemos((previous) => previous.map((memo) => (
        String(memo.id) === String(record.memoRecordId)
          ? {
            ...memo,
            memo: normalizedMemo,
            ledgerId: record.isUnlinkedMemo ? (memo.ledgerId || '') : record.id,
            updatedAt,
          }
          : memo
      )));
    } else {
      setMemos((previous) => [{
        id: Date.now() + Math.random(),
        assetId: record.assetId ?? null,
        name: record.name,
        ticker: record.ticker || '',
        category: record.category || '',
        currency: record.currency || 'KRW',
        round: getTradeRound(record),
        side: getTradeSide(record),
        action: getTradeSide(record) === 'sell' ? '매도' : '매수',
        quantity: record.quantity,
        price: record.price || (getTradeSide(record) === 'sell' ? record.sellPrice : record.buyPrice) || 0,
        date: getRecordDate(record),
        pnl: getRecordPnl(record),
        grossPnl: record.grossPnl,
        brokerId: record.brokerId || '',
        brokerName: record.brokerName || '',
        brokerFeeRate: record.brokerFeeRate || 0,
        brokerFeeRatePercent: record.brokerFeeRatePercent || 0,
        brokerFee: record.brokerFee || 0,
        sellTaxRatePercent: record.sellTaxRatePercent || 0,
        sellTax: record.sellTax || 0,
        memo: normalizedMemo,
        ledgerId: record.id,
        createdAt: updatedAt,
        updatedAt,
      }, ...previous]);
    }

    setExpandedTradeMemoId('');
    addLog('매매 메모를 저장했습니다.', 'success');
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
    const isTradedToday = date === new Date().toISOString().split('T')[0];
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

    const matchedAsset = assets.find((asset) => asset.name === manualMemo.stockName);
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
    buyDate: new Date().toISOString().split('T')[0],
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
  const sellDate = new Date().toISOString().split('T')[0];
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
  const sortedDrafts = [...normalizedDrafts].sort((a, b) => (
    getDateTimestampSeconds(a.date) - getDateTimestampSeconds(b.date)
  ));
  const nextBuyRows = sortedDrafts.map((lot, index) => {
    const existingRow = lot.ledgerId ? existingBuyRowsById.get(String(lot.ledgerId)) : null;
    const storedFxRate = Number(lot.fxRate) > 0 ? Number(lot.fxRate) : Number(existingRow?.fxRate) || 0;
    const lookedUpFxRate = getBuyDateFxState(selectedAssetToManageBuys.currency, lot.date).rate;
    const fxRate = (selectedAssetToManageBuys.currency || 'KRW') === 'KRW'
      ? 1
      : (storedFxRate > 0 ? storedFxRate : Number(lookedUpFxRate) || 0);

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
  const addBuyBrokerFee = calculateBuyFee(addBuyForm, addedQty, addedAvgNative, addBuyCurrency);
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

    if (isAdding && newAsset.priceInputCurrency === 'KRW' && newAsset.category !== '현금') {
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
    let cancelled = false;

    pendingBuyDateFxLookups.forEach(({ currency, date }) => {
      const key = getBuyDateFxKey(currency, date);
      const cached = buyDateFxRatesRef.current[key];
      if (cached && (cached.status === 'loading' || cached.status === 'ready')) return;

      setBuyDateFxRates(prev => ({ ...prev, [key]: { rate: 0, status: 'loading' } }));

      const resolve = async () => {
        // USD만 날짜별 과거 환율을 받아올 수 있다. 나머지는 현재 환율로 대신한다.
        if (currency === 'USD') {
          const rate = await fetchUsdKrwRateByDate(date);
          if (Number(rate) > 0) return { rate: Number(rate), status: 'ready' };
        }
        const fallback = getCachedKrwRate(currency, currencyRates, exchangeRate || 0, jpyKrwRate || 0);
        if (Number(fallback) > 0) return { rate: Number(fallback), status: 'ready' };
        return { rate: 0, status: 'error' };
      };

      resolve()
        .then((result) => {
          if (cancelled) return;
          setBuyDateFxRates(prev => ({ ...prev, [key]: result }));
        })
        .catch(() => {
          if (cancelled) return;
          setBuyDateFxRates(prev => ({ ...prev, [key]: { rate: 0, status: 'error' } }));
        });
    });

    return () => { cancelled = true; };
  }, [pendingBuyDateFxLookups, currencyRates, exchangeRate, jpyKrwRate]);

  const handleAddAsset = () => {
    if (!newAsset.name || !newAsset.quantity) return;
    if (newAsset.category !== '현금' && !newAsset.averagePrice) return;
    
    const ticker = normalizeInputTicker(newAsset.ticker);
    const assetCurrency = getAssetInputCurrency(newAsset.category, ticker, newAsset.currency);
    const parsedQty = parseNumber(newAsset.quantity);
    const enteredPrice = newAsset.category === '현금' ? 1 : parseNumber(newAsset.averagePrice);

    /**
     * 해외 종목의 단가를 원화로 입력한 경우.
     * 입력값은 원화이므로 매수일 환율로 나눠 현지 통화 단가로 되돌린다.
     * 이때 사용자가 적은 원화 금액이 곧 실제 투자 원금이므로 그대로 확정해 둔다
     * (환율을 되돌리는 과정에서 생기는 소수점 오차로 원금이 흔들리지 않게).
     */
    const isKrwPriceInput = assetCurrency !== 'KRW'
      && newAsset.category !== '현금'
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
    const buyBrokerFee = calculateBuyFee(newAsset, parsedQty, parsedAvgPrice, assetCurrency);
    // 기록된 요율이 늘 기록된 금액을 재현하게 맞춰 둔다. 그러지 않으면 나중에
    // 매수 기록 편집기가 요율로 다시 계산할 때 수수료가 통째로 튄다.
    const buyFeeRatePercent = deriveFeeRatePercent(buyBrokerFee, parsedQty * parsedAvgPrice);
    // 저장되는 averagePrice/currentPrice는 이름과 달리 '현지 통화' 단가다.
    // (원화 환산은 화면 계산에서 환율을 곱해 따로 만든다.)
    const nativeAveragePrice = parsedAvgPrice;

    // 이미 보유 중이면 그 회차에 합산(추가 매수)하고,
    // 전량 매도되어 남은 수량이 없으면 새 회차를 열어 이전 기록과 분리한다.
    const assetRound = newAsset.category === '현금'
      ? 1
      : resolveNextTradeRound({
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
    <div className="min-h-[100dvh] bg-canvas px-4 pt-5 pb-[calc(4rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-16 text-ink relative">
      
      {/* 동기화 라이브 피드백 */}
      <SyncStatusToast syncStatus={syncStatus} />

      <div className="max-w-[1320px] mx-auto space-y-5 md:space-y-6">
        
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

        {cloudLoadFailed && (
          <div
            role="alert"
            className="px-5 py-4 bg-warn-soft rounded-2xl flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <p className="flex-1 text-[14px] font-semibold text-ink leading-relaxed">
              클라우드 데이터를 불러오지 못해 저장을 멈췄습니다. 지금 수정한 내용은 이 기기에만 남으며, 다시 불러오면 계정에 저장된 내용으로 대체됩니다.
            </p>
            <button
              onClick={() => setCloudRetryToken(token => token + 1)}
              className="shrink-0 h-11 px-5 bg-ink text-surface rounded-xl font-bold text-[14px] hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              다시 불러오기
            </button>
          </div>
        )}

        {/* 탭 */}
        <TabNav activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'portfolio' && (
          <div className="space-y-5 anim-fade">
            <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
              {/* 히어로 — 총 평가금액 */}
              <div className="bg-surface rounded-[20px] p-6 lg:p-7 flex flex-col justify-center">
                <p className="text-[14px] font-semibold text-ink-mute">총 평가금액</p>
                <p className="mt-2 figure text-[32px] lg:text-[38px] font-bold text-ink leading-none wrap-break-word">
                  {formatMoney(totalConvertedKRW, 'KRW')}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[14px] font-bold tnum ${
                      dashboardSummary.totalReturnPercent >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'
                    }`}
                  >
                    {dashboardSummary.totalReturnPercent >= 0
                      ? <TrendingUp size={14} aria-hidden="true" />
                      : <TrendingDown size={14} aria-hidden="true" />}
                    {dashboardSummary.totalReturnPercent > 0 ? '+' : ''}
                    {dashboardSummary.totalReturnPercent.toFixed(2)}%
                  </span>
                  <span className={`text-[14px] font-semibold tnum ${dashboardSummary.evaluationProfitKRW >= 0 ? 'text-up' : 'text-down'}`}>
                    {dashboardSummary.evaluationProfitKRW > 0 ? '+' : ''}
                    {formatMoney(dashboardSummary.evaluationProfitKRW, 'KRW')}
                  </span>
                  <span className="text-[13px] font-medium text-ink-mute">
                    · 현금 제외 기준
                  </span>
                </div>
              </div>

              {/* 보조 지표 3개 */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: '보유 자산',
                    value: `${enhancedAssets.length.toLocaleString()}개`,
                    tone: 'text-ink',
                    helper: '등록된 종목 수',
                  },
                  {
                    label: '실현손익',
                    value: `${totalConvertedNetProfit > 0 ? '+' : ''}${formatMoney(totalConvertedNetProfit, 'KRW')}`,
                    tone: totalConvertedNetProfit >= 0 ? 'text-up' : 'text-down',
                    helper: '매도 시점 환율 기준',
                  },
                  {
                    label: '배당 수익',
                    value: dividendCurrencyParts.length > 0 ? dividendCurrencyParts.join(' / ') : formatMoney(0, 'KRW'),
                    tone: dashboardSummary.dividendKRW >= 0 ? 'text-ink' : 'text-down',
                    helper: '실제 입금 + 지급 완료 계산분',
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-surface rounded-[20px] p-4 lg:p-5 flex flex-col justify-center">
                    <p className="text-[13px] font-semibold text-ink-mute">{item.label}</p>
                    <p className={`mt-1.5 figure text-[17px] lg:text-[20px] font-bold leading-tight wrap-break-word ${item.tone}`}>
                      {item.value}
                    </p>
                    <p className="mt-1.5 text-[12px] font-medium text-ink-mute">{item.helper}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_30rem] xl:grid-cols-[minmax(0,1fr)_34rem] gap-4 lg:gap-5">
            {/* SVG 드릴다운 차트 */}
            <div className="order-2 lg:order-2 bg-surface p-6 lg:p-7 rounded-[20px] flex flex-col items-center h-full">
              <div className="w-full flex justify-between items-center mb-5 lg:mb-5">
                <h2 className="text-base lg:text-[16px] font-bold text-ink flex items-center gap-2"><PieIcon className="text-ink-soft" size={18}/> {selectedCategory ? `${selectedCategory}` : '자산 비중'}</h2>
                {selectedCategory && (
                  <button onClick={() => setSelectedCategory(null)} className="text-[11px] md:text-[12px] font-bold text-ink-soft bg-line-soft px-2 py-1 md:px-3 md:py-1.5 rounded-full flex items-center gap-1 hover:bg-line"><ArrowLeft size={10} /> 메인으로</button>
                )}
              </div>
              {enhancedAssets.length === 0 ? (
                <div className="w-full min-h-[18rem] md:min-h-80 flex flex-col items-center justify-center text-center px-3">
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-line-soft text-ink-soft flex items-center justify-center mb-4 md:mb-5">
                    <Target size={24} className="md:w-7 md:h-7" />
                  </div>
                  <p className="text-base md:text-lg font-bold text-ink">첫 자산을 추가해보세요</p>
                  <p className="mt-2 text-xs md:text-sm font-medium text-ink-mute leading-relaxed max-w-xs">
                    종목을 등록하면 비중, 수익률, 배당 기록이 이 화면에 바로 쌓입니다.
                  </p>
                  <button
                    onClick={() => {
                      setIsAdding(true);
                    }}
                    className="mt-6 inline-flex items-center gap-2 h-12 px-5 bg-brand text-surface rounded-2xl text-[15px] font-bold hover:bg-brand-strong active:scale-[0.99] transition-all"
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
                    /*
                     * 링은 클릭 좌표로 분류를 고르므로 키 이벤트에는 구조적으로
                     * 반응할 수 없다. role="button" + tabIndex만 달아두면 포커스는
                     * 가는데 Enter를 눌러도 아무 일이 없는 '죽은 정거장'이 된다.
                     * 같은 선택을 아래 범례의 진짜 버튼들이 이미 제공하므로,
                     * 링은 마우스 편의 장치로만 두고 보조기술에는 숨긴다.
                     */
                    aria-hidden="true"
                  />
                  <div className="absolute inset-[12%] rounded-full bg-surface shadow-inner shadow-line" />
	                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-4 lg:p-6">
	                    <span className="text-[11px] md:text-[12px] text-ink-mute font-bold tracking-[0.06em] mb-1">{selectedCategory ? `${selectedCategory}` : 'Total'}</span>
	                    <div className="flex flex-col items-center gap-0.5">
	                      {currentCategoryKRW > 0 && <span className="text-base md:text-lg lg:text-[clamp(1rem,1.35vw,1.35rem)] font-bold text-ink tracking-tight whitespace-nowrap">{formatMoney(currentCategoryKRW, 'KRW')}</span>}
	                      {currentCategoryKRW > 0 && currentCategoryUSD > 0 && <span className="text-[11px] text-ink-mute font-bold">+</span>}
	                      {currentCategoryUSD > 0 && <span className="text-base md:text-lg lg:text-[clamp(1rem,1.35vw,1.35rem)] font-bold text-ink tracking-tight whitespace-nowrap">{formatMoney(currentCategoryUSD, 'USD')}</span>}
	                    </div>
                    {isDomesticStockChart ? (
	                      <div className={`mt-2 md:mt-3 max-w-[82%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${profitBgTone}`}>
                        <span className="text-[11px] md:text-[11px] font-bold text-ink-mute">총 수익금액</span>
                        <span className={`text-[12px] md:text-[13px] font-bold ${profitTone}`}>
                          {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                        </span>
                      </div>
                    ) : isOverseasStockChart ? (
	                      <div className={`mt-2 md:mt-3 max-w-[82%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${currentCategoryProfitUSD >= 0 ? 'bg-up-soft border-up-soft' : 'bg-down-soft border-down-soft'}`}>
                        <span className="text-[11px] md:text-[11px] font-bold text-ink-mute">총 수익금액</span>
                        <span className={`text-[12px] md:text-[13px] font-bold ${currentCategoryProfitUSD >= 0 ? 'text-up' : 'text-down'}`}>
                          {currentCategoryProfitUSD > 0 ? '+' : ''}{formatMoney(currentCategoryProfitUSD, 'USD')}
                        </span>
                      </div>
                    ) : (
                      <>
	                        <div className="mt-2 md:mt-3 max-w-[86%] bg-canvas px-2 py-1 md:px-3 md:py-1.5 rounded-full flex items-center justify-center gap-1.5">
	                          <span className="text-[11px] md:text-[11px] font-bold text-ink-mute whitespace-nowrap">총 평가가치</span>
	                          <span className="text-[12px] md:text-[13px] lg:text-[13px] font-bold text-ink-soft whitespace-nowrap">{formatMoney(currentCategoryTotalConverted, 'KRW')}</span>
	                        </div>
	                        <div className={`mt-1.5 max-w-[86%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${profitBgTone}`}>
	                          <span className="text-[11px] md:text-[11px] font-bold text-ink-mute whitespace-nowrap">총 수익금액</span>
	                          <span className={`text-[12px] md:text-[13px] font-bold ${profitTone}`}>
                            {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                          </span>
                          {isOverseasStockChart && currentCategoryProfitUSD !== 0 && (
                            <span className={`text-[12px] md:text-[13px] font-bold ${profitTone}`}>
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
                  <button key={data.id || data.name} onClick={() => !selectedCategory && setSelectedCategory(data.name)} className={`w-full flex items-center justify-between p-3 lg:px-3 lg:py-2.5 rounded-xl border transition-all ${!selectedCategory ? 'bg-canvas border-line hover:bg-surface hover:border-line' : 'bg-surface border-line'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shadow-inner" style={{ backgroundColor: data.color }}></div>
                      <span className="text-[13px] md:text-xs font-bold text-ink-soft">{data.name}</span>
                    </div>
                    <span className="text-[12px] md:text-[13px] font-bold text-ink-mute">{data.percent.toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            </div>

            {/* List 섹션 */}
            <div className="order-1 lg:order-1 space-y-6 min-w-0">
              <div className="bg-surface rounded-[20px] overflow-hidden">
                <div className="p-5 lg:px-5 lg:py-4 border-b border-line flex justify-between items-center bg-surface">
                  <h3 className="text-base lg:text-[16px] font-bold text-ink">{selectedCategory ? `${selectedCategory} 상세 목록` : '보유 자산 상세'}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-left">
                    <thead className="hidden md:table-header-group">
                      <tr className="text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em] border-b border-line bg-canvas/50">
                        <th className="px-4 py-3 md:px-5 md:py-3.5 w-[30%]">종목/자산</th>
                        <th className="px-4 py-3 md:px-5 md:py-3.5 w-[38%]">상세 가치</th>
                        <th className="px-4 py-3 md:px-4 md:py-3.5 text-right w-[20%]">수익률</th>
                        <th className="px-4 py-3 md:px-3 md:py-3.5 text-center w-[12%]">관리</th>
                      </tr>
                    </thead>
                    <tbody className="block md:table-row-group divide-y divide-line-soft">
                      {visibleDetailAssets.map((asset) => {
                        // 해외(외화) 종목은 행마다 $ / ₩ 를 눌러 바꿔 볼 수 있다.
                        const nativeCurrency = asset.originalCurrency || asset.currency || 'KRW';
                        const canToggleCurrency = nativeCurrency !== 'KRW';
                        const isKrwView = canToggleCurrency && assetCurrencyView[asset.id] === 'KRW';
                        const viewCurrency = isKrwView ? 'KRW' : nativeCurrency;
                        const rate = Number(asset.krwRate) > 0 ? Number(asset.krwRate) : 1;
                        const todayRate = Number(asset.todayKrwRate) > 0 ? Number(asset.todayKrwRate) : rate;
                        const nativeAveragePrice = asset.nativeAveragePrice
                          || Number(asset.originalAveragePrice)
                          || Number(asset.averagePrice)
                          || 0;

                        /**
                         * ₩ 보기는 증권사 앱과 같은 기준이다.
                         * 원금은 매수 시점 환율로 실제 낸 원화, 평가금액은 오늘 환율.
                         * 그래서 손익에 환차손익이 함께 들어간다.
                         * $ 보기는 환율을 걷어낸 순수 주가 손익만 보여준다.
                         */
                        const view = isKrwView
                          ? {
                            purchase: asset.purchaseKRW,
                            averagePrice: asset.krwAveragePrice,
                            current: asset.currentKRW,
                            price: asset.nativeCurrentPrice * todayRate,
                            profit: asset.profitKRW,
                            returnPercent: asset.returnPercentKRW,
                          }
                          : {
                            purchase: asset.purchaseNative,
                            averagePrice: nativeAveragePrice,
                            current: asset.currentNative,
                            price: asset.nativeCurrentPrice,
                            profit: asset.profitNative,
                            returnPercent: asset.returnPercent,
                          };
                        // 매수 시점 환율을 다 모르면 원금이 오늘 환율로 환산된 근사값이다.
                        const isApproxKrwPrincipal = isKrwView && asset.purchaseKRWSource === 'today-rate';

                        return (
                        <tr key={asset.id} className="block md:table-row px-4 py-5 md:p-0 hover:bg-canvas/60 transition-all group">
                          <td className="block md:table-cell px-0 py-0 md:px-5 md:py-4 whitespace-nowrap align-middle">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-2xl md:rounded-xl flex items-center justify-center text-surface font-bold text-xl md:text-lg shadow-sm group-hover:scale-[1.02] transition-transform" style={{ backgroundColor: asset.color }}>
                                {asset.category === '현금' ? <Banknote size={20}/> : asset.name[0]}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-ink text-base md:text-[16px] leading-none truncate">{asset.name}</p>
                                <p className="text-xs md:text-[13px] text-ink-mute font-bold mt-2 md:mt-1.5 truncate">
                                  {asset.category === '현금' ? 'CASH' : asset.ticker} {asset.category !== '현금' && `• ${formatAssetQuantity(asset.quantity, asset.category)}${asset.category==='원자재'?'단위':'주'}`}
                                </p>
                                {asset.category !== '현금' && (
                                  <p className="text-[12px] md:text-[13px] text-ink-mute font-bold mt-1 truncate">
                                    최초 매수일 {asset.displayBuyDate || asset.buyDate || '-'}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="block md:table-cell px-0 py-4 md:px-5 md:py-4 align-middle">
                            {canToggleCurrency && (
                              <div className="flex items-center justify-end gap-1 mb-2 px-4 md:px-0">
                                <div className="seg inline-flex items-center p-0.5 rounded-[10px]" role="group" aria-label="통화 전환">
                                  {[
                                    { key: 'NATIVE', label: nativeCurrency === 'JPY' ? '¥' : '$' },
                                    { key: 'KRW', label: '₩' },
                                  ].map((option) => {
                                    const active = option.key === 'KRW' ? isKrwView : !isKrwView;
                                    return (
                                      <button
                                        key={option.key}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAssetCurrencyView(prev => ({ ...prev, [asset.id]: option.key }));
                                        }}
                                        aria-pressed={active}
                                        title={option.key === 'KRW' ? '원화로 보기' : '현지 통화로 보기'}
                                        className={`seg-item px-2.5 py-1 rounded-lg text-[12px] md:text-[13px] font-bold leading-none ${
                                          active ? 'text-ink' : 'text-ink-mute hover:text-ink-soft'
                                        }`}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-x-4 md:gap-x-5 gap-y-3 md:gap-y-1.5 bg-canvas/80 md:bg-transparent px-4 py-3.5 md:p-0 rounded-xl md:rounded-none group-transition-colors w-full min-w-0">
                              <div className="flex flex-col">
                                <span className="text-[11px] md:text-[11px] text-ink-mute font-bold whitespace-nowrap overflow-hidden text-ellipsis">
                                  {asset.category === '현금' ? '보유 원금' : '총 매입'}
                                  {isKrwView && asset.purchaseKRWSource === 'manual' && ' · 직접 입력'}
                                  {isApproxKrwPrincipal && ' · 오늘 환율'}
                                </span>
                                <span className="font-bold text-ink-soft text-xs md:text-[14px] mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.purchase, viewCurrency)}</span>
                              </div>
                              <div className="flex flex-col text-right">
                                {asset.category !== '현금' && (
                                  <><span className="text-[11px] md:text-[11px] text-ink-mute font-bold">평단가</span><span className="font-bold text-ink-soft text-xs md:text-[14px] mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.averagePrice, viewCurrency)}</span></>
                                )}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[11px] md:text-[11px] text-ink-soft font-bold">총 가치</span>
                                <span className="font-bold text-ink text-xs md:text-[14px] mt-1 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.current, viewCurrency)}</span>
                              </div>
                              <div className="flex flex-col text-right">
                                {asset.category !== '현금' && (
                                  <><span className="text-[11px] md:text-[11px] text-ink-soft font-bold">현재가</span><span className="font-bold text-ink text-xs md:text-[14px] mt-1 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.price, viewCurrency)}</span></>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="block md:table-cell px-0 pb-4 md:px-4 md:py-4 text-left md:text-right whitespace-nowrap align-middle">
                            {asset.category === '현금' ? <span className="text-[12px] md:text-xs font-bold text-ink-mute">-</span> : (
                              <div className="flex flex-row md:flex-col items-stretch md:items-end gap-2">
                                <div className={`inline-flex items-center justify-center gap-1.5 flex-1 md:flex-none md:w-full px-2 md:px-2.5 py-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[14px] font-bold ${view.returnPercent >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                                  {view.returnPercent >= 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} {Math.abs(view.returnPercent).toFixed(2)}%
                                </div>
                                <div className={`inline-flex items-center justify-center flex-1 md:flex-none md:w-full px-2 md:px-2.5 py-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[14px] font-bold ${view.profit >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                                  {view.profit > 0 ? '+' : ''}{formatMoney(view.profit, viewCurrency)}
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
                                  className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-ink hover:bg-line-soft transition-colors px-2.5 py-2 rounded-xl text-[13px] font-bold"
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
                                  className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-warn hover:bg-warn-soft transition-colors px-2.5 py-2 rounded-xl text-[13px] font-bold"
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
                                  className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-brand hover:bg-brand-soft transition-colors px-2.5 py-2 rounded-xl text-[13px] font-bold"
                                  title="매수 기록 관리"
                                >
                                  <CalendarDays size={16} className="md:w-4.5 md:h-4.5" />
                                  <span className="md:hidden">매수 기록</span>
                                </button>
                              </>
                            )}

                            <button
                              onClick={(e) => requestRemoveAsset(asset.id, e)}
                              className="inline-flex items-center justify-center gap-1.5 text-ink-mute hover:text-danger hover:bg-danger-soft transition-colors px-2.5 py-2 rounded-xl text-[13px] font-bold"
                              title="자산 삭제"
                            >
                              <Trash2 size={16} className="md:w-4.5 md:h-4.5" />
                            </button>
                          </div>
                        </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {enhancedAssets.length === 0 && (
                    <div className="p-6 md:p-12 text-center">
                      <div className="mx-auto w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-canvas text-ink-mute flex items-center justify-center mb-4">
                        <Wallet size={24} />
                      </div>
                      <p className="text-ink font-bold text-sm md:text-base">아직 등록된 자산이 없습니다.</p>
                      <p className="mt-2 text-ink-mute font-medium text-xs md:text-sm">주식, 원자재, 현금을 추가하면 상세 가치와 수익률이 표시됩니다.</p>
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
          <div className="space-y-8 anim-fade">
            <h3 className="text-lg md:text-xl font-bold text-ink flex items-center gap-2"><TrendingUp className="text-ink-soft" size={20} /> 평가손익(미실현) 요약</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><Banknote size={20} /></div>
                <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">국내주식 평가손익</p>
                <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${dashboardSummary.krwEvaluationProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {dashboardSummary.krwEvaluationProfit > 0 ? '+' : ''}{formatMoney(dashboardSummary.krwEvaluationProfit, 'KRW')}
                </p>
              </div>
              <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><DollarSign size={20} /></div>
                <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">해외주식 평가손익</p>
                <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${dashboardSummary.usdEvaluationProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {dashboardSummary.usdEvaluationProfit > 0 ? '+' : ''}{formatMoney(dashboardSummary.usdEvaluationProfit, 'USD')}
                </p>
              </div>
              <div className="bg-ink p-5 md:p-7 rounded-2xl shadow-sm flex flex-col justify-center text-surface relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><PieIcon size={50}/></div>
                <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">총 환산 평가손익</p>
                <p className={`text-3xl md:text-4xl font-bold tracking-tighter ${dashboardSummary.investedProfitKRW >= 0 ? 'text-up' : 'text-down'}`}>
                  {dashboardSummary.investedProfitKRW > 0 ? '+' : ''}{formatMoney(dashboardSummary.investedProfitKRW, 'KRW')}
                </p>
              </div>
            </div>

            <h3 className="text-lg md:text-xl font-bold text-ink flex items-center gap-2"><ArrowRightLeft className="text-ink-soft" size={20} /> 종목 매매(실현) 수익 요약</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><Banknote size={20} /></div>
                <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">원화 매매 순수익</p>
                <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${krwNetProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {krwNetProfit > 0 ? '+' : ''}{formatMoney(krwNetProfit, 'KRW')}
                </p>
              </div>
              <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><DollarSign size={20} /></div>
                <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">달러 매매 순수익</p>
                <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${usdNetProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {usdNetProfit > 0 ? '+' : ''}{formatMoney(usdNetProfit, 'USD')}
                </p>
              </div>
              <div className="bg-ink p-5 md:p-7 rounded-2xl shadow-sm flex flex-col justify-center text-surface relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet size={50}/></div>
                <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">총 환산 매매 순수익</p>
                <p className={`text-3xl md:text-4xl font-bold tracking-tighter ${totalConvertedNetProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {totalConvertedNetProfit > 0 ? '+' : ''}{formatMoney(totalConvertedNetProfit, 'KRW')}
                </p>
              </div>
            </div>

            <div className="bg-surface rounded-[20px] overflow-hidden">
              <div className="p-5 md:p-7 border-b border-line flex items-center gap-2">
                <h3 className="text-base md:text-lg font-bold text-ink">
                  {annualReturnYear}년 해외주식 양도소득세 (추정)
                </h3>
                <FeatureInfo text="같은 해 해외 종목 손익을 통산해 기본공제 250만원을 뺀 뒤 22%(양도세 20% + 지방소득세 2%)를 매깁니다. 국내주식과는 통산되지 않고, 환차익도 과세 대상이라 매수일·매도일 환율을 각각 적용합니다. 실제 신고는 이듬해 5월입니다." />
              </div>
              <div className="p-5 md:p-7 grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-[11px] font-bold text-ink-mute">통산 양도차익</p>
                  <p className={`figure text-lg md:text-xl font-bold mt-1 ${overseasCapitalGainsTax.netGainKRW >= 0 ? 'text-up' : 'text-down'}`}>
                    {overseasCapitalGainsTax.netGainKRW > 0 ? '+' : ''}{formatMoney(overseasCapitalGainsTax.netGainKRW, 'KRW')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-ink-mute">남은 기본공제</p>
                  <p className="figure text-lg md:text-xl font-bold text-ink mt-1">
                    {formatMoney(overseasCapitalGainsTax.remainingDeductionKRW, 'KRW')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-ink-mute">과세표준</p>
                  <p className="figure text-lg md:text-xl font-bold text-ink mt-1">
                    {formatMoney(overseasCapitalGainsTax.taxBaseKRW, 'KRW')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-ink-mute">예상 세액</p>
                  <p className="figure text-lg md:text-xl font-bold text-ink mt-1">
                    {formatMoney(overseasCapitalGainsTax.taxKRW, 'KRW')}
                  </p>
                </div>
              </div>
              <p className="px-5 pb-5 md:px-7 md:pb-7 text-[11px] font-semibold text-ink-mute leading-relaxed">
                매도 {overseasCapitalGainsTax.tradeCount.toLocaleString()}건 기준
                {overseasCapitalGainsTax.estimated ? ' · 환율이나 취득가액이 없는 기록이 있어 일부는 추정했습니다.' : ''}
                {overseasCapitalGainsTax.unresolvedCount > 0
                  ? ` · 취득가액을 알 수 없는 ${overseasCapitalGainsTax.unresolvedCount.toLocaleString()}건은 뺐습니다.`
                  : ''}
              </p>
            </div>

            <div className="bg-surface rounded-[20px] overflow-hidden">
              <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface">
                <div className="flex items-center gap-2">
                  <h3 className="text-base md:text-lg font-bold text-ink">종목별 총 손익</h3>
                  <FeatureInfo text="평가손익, 실현손익, 세후 배당을 합산합니다." />
                </div>
                <div className="relative w-full md:w-72">
                  <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute" />
                  <input
                    value={performanceSearchTerm}
                    onChange={(e) => setPerformanceSearchTerm(e.target.value)}
                    placeholder="종목명 또는 티커 검색"
                    className="w-full pl-10 pr-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold text-ink-soft"
                  />
                </div>
              </div>
              <div className="max-h-[480px] overflow-auto scroll-soft">
                <table className="w-full text-left table-auto">
                  <thead className="sticky top-0 z-10 bg-canvas text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em]">
                    <tr>
                      <th className="px-4 py-4 md:px-8 md:py-5">종목</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">보유/매도</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">평가 손익</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">실현 손익</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">세후 배당</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">총 손익</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {filteredPerformanceSummary.map((summary) => {
                      const isForeignCurrency = summary.currency !== 'KRW';
                      const unrealizedDisplay = isForeignCurrency ? summary.unrealizedNative : summary.unrealizedKRW;
                      const realizedDisplay = isForeignCurrency ? summary.realizedNative : summary.realizedKRW;
                      const dividendDisplay = isForeignCurrency ? summary.dividendNative : summary.dividendKRW;
                      const totalDisplay = isForeignCurrency ? summary.totalNative : summary.totalKRW;
                      const displayCurrency = isForeignCurrency ? summary.currency : 'KRW';
                      const totalTone = totalDisplay >= 0 ? 'text-up bg-up-soft' : 'text-down bg-down-soft';
                      return (
                        <tr key={summary.key || summary.name} className="hover:bg-canvas transition-colors">
                          <td className="px-4 py-4 md:px-8 md:py-6 whitespace-nowrap">
                            <p className="text-sm md:text-base font-bold text-ink">{summary.name}</p>
                            <p className="text-[11px] md:text-[12px] font-bold text-ink-mute mt-1">
                              {summary.ticker || summary.category || '기록 종목'}
                              {summary.displayDate && ` • ${summary.displayDate} ${summary.displayDateLabel}`}
                            </p>
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                            {/* 이미 정리된 포지션은 매도 수량이 주인공이므로 위로 올린다.
                                보유 중인 종목은 반대로 보유 수량이 먼저다. */}
                            {summary.isClosedPosition ? (
                              <>
                                <div>매도 {summary.totalSellQuantity.toLocaleString()}주</div>
                                <div className="text-ink-mute mt-1">보유 {summary.quantity.toLocaleString()}주</div>
                              </>
                            ) : (
                              <>
                                <div>보유 {summary.quantity.toLocaleString()}주</div>
                                <div className="text-ink-mute mt-1">매도 {summary.totalSellQuantity.toLocaleString()}주</div>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                            {unrealizedDisplay > 0 ? '+' : ''}{formatMoney(unrealizedDisplay, displayCurrency)}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                            {realizedDisplay > 0 ? '+' : ''}{formatMoney(realizedDisplay, displayCurrency)}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                            {dividendDisplay > 0 ? '+' : ''}{formatMoney(dividendDisplay, displayCurrency)}
                          </td>
                          <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                            <div className="flex flex-col items-end gap-1">
                              {isForeignCurrency && (
                                <>
                                  <span className={`inline-flex px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold ${totalTone}`}>
                                    {summary.totalNative > 0 ? '+' : ''}{formatMoney(summary.totalNative, summary.currency)}
                                  </span>
                                  <span className="text-[12px] md:text-xs font-bold text-ink-mute">
                                    원화 기준 합계 {summary.totalKRW > 0 ? '+' : ''}{formatMoney(summary.totalKRW, 'KRW')}
                                  </span>
                                </>
                              )}
                              {!isForeignCurrency && (
                                <span className={`inline-flex px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold ${totalTone}`}>
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
                  <p className="p-8 md:p-10 text-center text-ink-mute font-bold text-xs md:text-sm">검색 결과가 없습니다.</p>
                )}
              </div>
            </div>

            <div className="bg-surface p-5 md:p-7 rounded-[20px]">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-3 md:gap-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg md:text-xl font-bold flex items-center gap-2 md:gap-3">
                    <Receipt className="text-ink-soft" size={20}/>
                    {selectedDividendAsset ? `${selectedDividendAsset} 배당 상세 기록` : '종목별 누적 배당 요약'}
                  </h3>
                  <FeatureInfo text="실제 입금액을 우선하고, 나머지는 공식 분배금과 기준일 보유수량으로 계산합니다." />
                </div>
                
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  <input
                    ref={dividendImportInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleConfirmedDividendImport}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => dividendImportInputRef.current?.click()}
                    className="text-[11px] md:text-[12px] font-bold text-ink-soft bg-line-soft px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:bg-line transition-all"
                  >
                    <ArrowRightLeft size={12} /> 복구 파일 불러오기
                  </button>
                  <button
                    type="button"
                    onClick={openActualDividendForm}
                    className="text-[11px] md:text-[12px] font-bold text-white bg-brand px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:opacity-90 transition-all"
                  >
                    <Plus size={12} /> 실제 입금 추가
                  </button>
                  {selectedDividendAsset && (
                    <>
                    <select 
                      value={dividendFilter} 
                      onChange={e => setDividendFilter(e.target.value)}
                      className="px-3 py-1.5 md:px-4 md:py-2 bg-canvas rounded-lg md:rounded-xl text-[12px] md:text-xs font-bold outline-none text-ink-soft"
                    >
                      <option value="이번 달">이번 달</option>
                      <option value="올해">올해</option>
                      <option value="전체">전체 기간</option>
                    </select>
                    <button onClick={() => { setSelectedDividendAsset(null); setDividendFilter('전체'); }} className="text-[11px] md:text-[12px] font-bold text-ink-soft bg-line-soft px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:bg-line transition-all">
                      <ArrowLeft size={12} /> 전체 보기
                    </button>
                    </>
                  )}
                </div>
              </div>

              {!selectedDividendAsset ? (
                <div className="max-h-[620px] overflow-y-auto pr-1 md:pr-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {currentDividendSummaryGroups.length > 0 && (
                    <DividendSummaryGrid
                      groups={currentDividendSummaryGroups}
                      onSelect={setSelectedDividendAsset}
                    />
                  )}

                  {historicalDividendCount > 0 && (
                    <details className="col-span-full rounded-2xl border border-line bg-canvas/60 overflow-hidden">
                      <summary className="cursor-pointer list-none px-5 py-4 md:px-6 md:py-5 flex items-center justify-between gap-3 font-bold text-sm md:text-base text-ink hover:bg-canvas">
                        <span>과거 보유 · 배당 수령 내역</span>
                        <span className="text-[11px] md:text-xs text-ink-mute">{historicalDividendCount}종목 · 클릭하여 보기</span>
                      </summary>
                      <div className="border-t border-line p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                        <DividendSummaryGrid
                          groups={historicalDividendSummaryGroups}
                          onSelect={setSelectedDividendAsset}
                        />
                      </div>
                    </details>
                  )}

                  {currentDividendSummaryGroups.length === 0 && historicalDividendCount === 0 && (
                    <div className="col-span-full py-8 md:py-12 text-center text-ink-mute font-bold text-xs md:text-sm">
                      {isFetching ? '배당 데이터를 갱신 중입니다...' : '매수일 이후 배당 내역이 없거나 데이터를 불러올 수 없습니다.'}
                    </div>
                  )}
                  </div>
                </div>
              ) : (
                <div className="bg-canvas rounded-2xl p-1 md:p-2">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left table-auto">
                      <thead className="text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em] border-b border-line/50">
                        <tr>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">기준 수량</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">주당 세후</th>
                          <th className="px-4 py-4 md:px-8 md:py-5">지급 기준 일자</th>
                          <th className="px-4 py-4 md:px-8 md:py-5">종목명</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">세전</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">세금</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">세후</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-center">상태</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-center">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {filteredHistory.length > 0 ? filteredHistory.map(div => (
                          <tr key={div.id} className="hover:bg-surface transition-colors group">
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">{Number(div.quantity) > 0 ? `${Number(div.quantity).toLocaleString()}주` : '-'}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">{Number(div.perShareNetAmount) > 0 ? formatMoney(div.perShareNetAmount, div.currency) : '-'}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                              {(div.actualPaymentDate || div.paymentDate)
                                ? `지급일 ${getDividendReportingDate(div)}`
                                : `배당락일 ${getDividendExDate(div)}`}
                              <span className="block mt-1 text-[11px] text-ink-mute">
                                {`배당기준일 ${div.recordDate || getDividendEligibilityDate(div) || getDividendExDate(div)}`}
                              </span>
                              <span className="block mt-1 text-[11px] text-ink-mute">
                                배당지급일 {getDividendOfficialPaymentDate(div) || '미정'}
                              </span>
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-sm md:text-base font-bold text-ink whitespace-nowrap">{div.name}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">{Number.isFinite(Number(div.grossAmount)) ? formatMoney(div.grossAmount, div.currency) : '-'}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-down whitespace-nowrap">{Number.isFinite(Number(div.taxAmount)) ? `-${formatMoney(div.taxAmount, div.currency)}` : '-'}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-sm md:text-base font-bold text-ink whitespace-nowrap">{formatMoney(div.amount, div.currency)}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-center whitespace-nowrap">
                              <span className="text-[11px] md:text-[12px] bg-up-soft text-up px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl font-bold">
                                {isConfirmedDividendRecord(div)
                                  ? '실제 입금·확정'
                                  : `${getAccountTypeLabel(div.accountType)} · 자동 계산`}
                              </span>
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-center whitespace-nowrap">
                              {isConfirmedDividendRecord(div) ? (
                                <button
                                  type="button"
                                  onClick={() => removeConfirmedDividend(div.id)}
                                  className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
                                  title="실제 입금 기록 삭제"
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : '-'}
                            </td>
                          </tr>
                        )) : (
                          <tr>
                              <td colSpan="9" className="px-4 py-12 md:px-8 md:py-16 text-center">
                              <p className="text-ink-mute font-bold mb-2 text-xs md:text-sm">해당하는 배당 지급 내역이 없습니다.</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-surface rounded-[20px] overflow-hidden">
              <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-surface">
                <div className="flex items-center gap-2">
                  <h3 className="text-base md:text-lg font-bold text-ink">과거 매매 기록 · 메모</h3>
                  <FeatureInfo text="매수·매도 내역과 당시 판단 근거를 한곳에서 관리합니다." />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsManualTradeEntryOpen((previous) => !previous)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-ink text-surface rounded-xl font-bold text-xs shadow-sm"
                  >
                    {isManualTradeEntryOpen ? <X size={16} /> : <PlusCircle size={16} />}
                    {isManualTradeEntryOpen ? '입력 닫기' : '누락 매매 기록 추가'}
                  </button>
                </div>
              </div>
              {isManualTradeEntryOpen && (
                <ManualTradeEntryForm
                  value={manualMemo}
                  stockOptions={manualTradeStockOptions}
                  onChange={setManualMemo}
                  onSubmit={handleAddManualMemo}
                  onClose={() => setIsManualTradeEntryOpen(false)}
                />
              )}
              <div className="p-5 md:p-6 border-b border-line bg-surface space-y-4">
                <div className="flex flex-col md:flex-row gap-3">
                  <StockFilterCombobox
                    value={tradeStockFilter}
                    onChange={setTradeStockFilter}
                    options={tradeStockFilterOptions}
                    ariaLabel="과거 매매 기록 종목 필터"
                  />
                  <select
                    value={tradeSideFilter}
                    onChange={(e) => setTradeSideFilter(e.target.value)}
                    aria-label="매수 또는 매도 필터"
                    className="px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft"
                  >
                    <option value="all">전체 거래</option>
                    <option value="buy">매수</option>
                    <option value="sell">매도</option>
                  </select>
                  <select
                    value={tradeSortMode}
                    onChange={(e) => setTradeSortMode(e.target.value)}
                    className="px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft"
                  >
                    {TRADE_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className={`grid grid-cols-1 gap-3 ${tradeStockFilter !== 'all' ? 'md:grid-cols-3' : ''}`}>
                  {tradeStockFilter !== 'all' && (
                    <>
                      <div className="bg-canvas rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">총 매수 수량</p>
                        <p className="text-lg font-bold text-ink">{tradeSummary.totalBuyQuantity.toLocaleString()}</p>
                      </div>
                      <div className="bg-canvas rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">총 매도 수량</p>
                        <p className="text-lg font-bold text-ink">{tradeSummary.totalSellQuantity.toLocaleString()}</p>
                      </div>
                    </>
                  )}
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-[12px] font-bold text-ink-mute mb-1">실현 손익</p>
                    <p className={`text-lg font-bold ${tradeSummary.totalProfit >= 0 ? 'text-up' : 'text-down'}`}>
                      {tradeSummary.totalProfit > 0 ? '+' : ''}{formatMoney(tradeSummary.totalProfit, 'KRW')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left table-auto">
                  <thead className="bg-canvas/50 text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em]">
                    <tr>
                      <th className="px-4 py-4 md:px-8 md:py-5">종목</th>
                      <th className="px-4 py-4 md:px-8 md:py-5">매수/매도일</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">매수가/매도가</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">실현 손익</th>
                      <th className="px-4 py-4 md:px-8 md:py-5">메모</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-center">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {displayedTrades.map((trade) => {
                      const side = getTradeSide(trade);
                      const action = side === 'sell' ? '매도' : '매수';
                      const date = getRecordDate(trade);
                      const price = side === 'sell'
                        ? (trade.price || trade.sellPrice)
                        : (trade.price || trade.buyPrice);
                      const pnl = getRecordPnl(trade);
                      const brokerFee = Number(trade.brokerFee) || 0;
                      const sellTax = Number(trade.sellTax) || 0;
                      const rowKey = `${trade.sourceType}-${trade.id}`;
                      const isMemoExpanded = expandedTradeMemoId === rowKey;

                      return (
                        <React.Fragment key={rowKey}>
                          <tr className={`transition-colors ${isMemoExpanded ? 'bg-canvas/70' : 'hover:bg-canvas'}`}>
                            <td className="px-4 py-4 md:px-8 md:py-6 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex px-2 py-1 rounded-lg text-[12px] font-bold ${side === 'sell' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>
                                  {action}
                                </span>
                                <div>
                                  <p className="text-sm md:text-base font-bold text-ink">{trade.name}</p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    {trade.ticker && (
                                      <p className="text-[11px] md:text-[12px] font-bold text-ink-mute">{trade.ticker}</p>
                                    )}
                                    {trade.isUnlinkedMemo && (
                                      <span className="inline-flex px-2 py-0.5 rounded-md bg-warn-soft text-warn text-[10px] font-bold">미연결 기록</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-6 text-[12px] md:text-xs text-ink-soft font-bold whitespace-nowrap">
                              <span className="text-ink-mute mr-1 md:mr-2">{action}일:</span>{date || '-'}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft space-y-1 whitespace-nowrap">
                              <div>{formatMoney(price, trade.currency)}</div>
                              <div className="text-ink-mute">{Number(trade.quantity || 0).toLocaleString()}주</div>
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                              {side === 'sell' ? (
                                <div className="flex flex-col items-end gap-1">
                                  <span className={`inline-flex font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl text-[12px] md:text-xs ${pnl >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                                    {pnl > 0 ? '+' : ''}{formatMoney(pnl, trade.currency)}
                                  </span>
                                  {brokerFee > 0 && (
                                    <span className="text-[11px] font-bold text-ink-mute">
                                      수수료 -{formatMoney(brokerFee, trade.currency)}
                                    </span>
                                  )}
                                  {sellTax > 0 && (
                                    <span className="text-[11px] font-bold text-ink-mute">
                                      제세금 -{formatMoney(sellTax, trade.currency)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[12px] md:text-xs font-bold text-ink-mute">-</span>
                              )}
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-6 min-w-48 max-w-72">
                              <button
                                type="button"
                                onClick={() => setExpandedTradeMemoId((previous) => previous === rowKey ? '' : rowKey)}
                                title={trade.memo || '메모 추가'}
                                className={`w-full inline-flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${trade.memo ? 'bg-brand-soft text-ink-soft' : 'bg-canvas text-ink-mute hover:text-ink'}`}
                              >
                                <NotebookPen size={15} className="shrink-0" />
                                <span className="truncate text-[11px] md:text-xs font-bold">{trade.memo || '메모 추가'}</span>
                              </button>
                            </td>
                            <td className="px-4 py-4 md:px-8 md:py-6 text-center whitespace-nowrap">
                              {!trade.isUnlinkedMemo ? (
                                <button onClick={(e) => removeTrade(trade, e)} className="text-ink-mute hover:text-danger hover:bg-danger-soft transition-colors p-1.5 md:p-2 rounded-xl" title="매매 기록 삭제 · 메모는 보존"><Trash2 size={16} /></button>
                              ) : (
                                <div className="inline-flex items-center justify-center gap-2">
                                  <span className="text-[11px] font-bold text-ink-mute">메모만 보존</span>
                                  <button
                                    type="button"
                                    onClick={(e) => removeTradeMemo(trade, e)}
                                    className="text-ink-mute hover:text-danger hover:bg-danger-soft transition-colors p-1.5 md:p-2 rounded-xl"
                                    title="보존된 미연결 기록 삭제"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                          {isMemoExpanded && (
                            <tr>
                              <td colSpan="6" className="px-4 pb-4 md:px-8 md:pb-6 bg-canvas/40">
                                <TradeMemoEditor
                                  key={rowKey}
                                  record={trade}
                                  onSave={(memoText) => updateTradeMemo(trade, memoText)}
                                  onDelete={(event) => removeTradeMemo(trade, event)}
                                  onClose={() => setExpandedTradeMemoId('')}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {visibleTrades.length === 0 && <p className="p-8 md:p-10 text-center text-ink-mute font-bold text-xs md:text-sm">표시할 매매 기록이 없습니다.</p>}
              </div>
              {visibleTrades.length > 0 && (
                <div className="px-5 py-4 md:px-8 md:py-5 border-t border-line bg-canvas/40 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="text-[12px] md:text-xs font-bold text-ink-mute">
                    최근 {displayedTrades.length.toLocaleString()}개 표시 중 / 전체 {visibleTrades.length.toLocaleString()}개
                  </p>
                  <div className="flex gap-2">
                    {hasMoreTrades && (
                      <button
                        onClick={() => setTradeVisibleCount(count => count + TRADE_PAGE_SIZE)}
                        className="px-4 py-2 bg-canvas rounded-xl text-[12px] md:text-xs font-bold text-ink-soft hover:text-ink transition-colors"
                      >
                        더보기
                      </button>
                    )}
                    {displayedTrades.length > TRADE_PAGE_SIZE && (
                      <button
                        onClick={() => setTradeVisibleCount(TRADE_PAGE_SIZE)}
                        className="px-4 py-2 bg-canvas rounded-xl text-[12px] md:text-xs font-bold text-ink-mute hover:text-ink-soft transition-colors"
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
          <div className="space-y-8 anim-fade">
            <AnnualReturnGoalCard
              year={annualReturnYear}
              targetPercent={targetPortfolio.annualReturnGoals?.[annualReturnYear] || ''}
              performance={selectedAnnualPerformance}
              onYearChange={setAnnualReturnYear}
              onTargetChange={(value) => setTargetPortfolio((previous) => ({
                ...previous,
                annualReturnGoals: {
                  ...(previous.annualReturnGoals || {}),
                  [annualReturnYear]: value,
                },
              }))}
            />
            <AnnualReturnHistory
              year={annualReturnYear}
              years={annualPerformanceYears}
              performance={selectedAnnualPerformance}
              performances={annualPerformances}
              onYearChange={setAnnualReturnYear}
            />
            <div className="bg-surface rounded-[20px] overflow-hidden">
              <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface">
                <div className="flex items-center gap-2">
                  <h3 className="text-base md:text-lg font-bold text-ink">목표 포트폴리오 설정</h3>
                  <FeatureInfo text="분류별 목표 비중과 분류 안 종목별 목표 비중을 저장합니다." />
                </div>
                <div className="w-full md:w-80">
                  <label htmlFor="app-field-1" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                    기준 총 예산
                  </label>
                  <input id="app-field-1"
                    value={formatInputNumber(targetPortfolio.budget)}
                    onChange={(e) => setTargetPortfolio(prev => ({ ...prev, budget: sanitizeNumericInput(e.target.value) }))}
                    placeholder={`현재 총자산 ${formatMoney(totalConvertedKRW, 'KRW')}`}
                    className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand text-sm font-bold text-ink"
                  />
                </div>
              </div>

              <div className="p-5 md:p-6 border-b border-line bg-surface">
                <div className="flex flex-col md:flex-row gap-3 md:items-end">
                  <div className="flex-1">
                    <label htmlFor="app-field-2" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                      분류 추가
                    </label>
                    <select id="app-field-2"
                      value={targetCategoryDraft}
                      onChange={(e) => setTargetCategoryDraft(e.target.value)}
                      className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft"
                    >
                      {ASSET_CATEGORIES.map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={addTargetCategory}
                    className="h-12 px-5 bg-ink text-surface rounded-2xl font-bold text-[14px] flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                  >
                    <Plus size={16} /> 분류 추가
                  </button>
                  <div className={`px-5 py-3 rounded-xl border text-xs md:text-sm font-bold ${Math.abs(targetCategoryTotalPercent - 100) < 0.001 ? 'bg-brand-soft text-brand' : 'bg-warn-soft text-warn'}`}>
                    전체 목표 {targetCategoryTotalPercent.toFixed(1)}%
                  </div>
                  {Math.abs(targetCategoryTotalPercent - 100) >= 0.001 && targetPortfolio.categories.length > 0 && (
                    <button
                      onClick={normalizeCategoryPercents}
                      className="px-4 py-3 bg-line-soft text-ink-soft rounded-xl font-bold text-xs hover:bg-line transition-colors"
                      title="지금 넣은 비율은 유지한 채 합만 100%로 맞춥니다"
                    >
                      100%로 맞추기
                    </button>
                  )}
                  {targetPriceSyncStatus && (
                    <div className="px-5 py-3 rounded-xl border bg-canvas border-line text-ink-soft text-xs md:text-sm font-bold">
                      {targetPriceSyncStatus}
                    </div>
                  )}
                  <div className="flex bg-line-soft rounded-xl p-1">
                    {[
                      { id: 'table', label: '표' },
                      { id: 'chart', label: '파이그래프' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setTargetViewMode(mode.id)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${targetViewMode === mode.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-mute hover:text-ink-soft'}`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {(targetRebalancePlan.buys.length > 0 || targetRebalancePlan.sells.length > 0) && (
                <div className="p-5 md:p-7 border-b border-line bg-canvas/40">
                  <div className="flex items-center gap-2 mb-4">
                    <h4 className="text-sm md:text-base font-bold text-ink">리밸런싱 실행 계획</h4>
                    <FeatureInfo text="폴더 안에 흩어진 매수·매도 필요 종목을 금액이 큰 순서로 모았습니다." />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-surface rounded-2xl p-4 md:p-5">
                      <p className="text-[11px] font-bold text-up mb-3">매수 필요 · {targetRebalancePlan.buys.length}건</p>
                      <div className="space-y-2">
                        {targetRebalancePlan.buys.map((action) => (
                          <div key={action.key} className="flex items-center justify-between gap-3 text-xs md:text-sm">
                            <div className="min-w-0">
                              <p className="font-bold text-ink truncate">
                                {action.name}
                                {!action.isMatched && <span className="ml-1.5 text-[10px] font-bold text-warn">미연동</span>}
                              </p>
                              <p className="text-[11px] text-ink-mute font-semibold truncate">{action.categoryId} · {action.groupName}</p>
                            </div>
                            <p className="shrink-0 font-bold text-up">+{formatMoney(action.amountKRW, 'KRW')}</p>
                          </div>
                        ))}
                        {targetRebalancePlan.buys.length === 0 && (
                          <p className="text-xs font-semibold text-ink-mute">매수가 필요한 종목이 없습니다.</p>
                        )}
                      </div>
                    </div>
                    <div className="bg-surface rounded-2xl p-4 md:p-5">
                      <p className="text-[11px] font-bold text-down mb-3">매도 필요 · {targetRebalancePlan.sells.length}건</p>
                      <div className="space-y-2">
                        {targetRebalancePlan.sells.map((action) => (
                          <div key={action.key} className="flex items-center justify-between gap-3 text-xs md:text-sm">
                            <div className="min-w-0">
                              <p className="font-bold text-ink truncate">
                                {action.name}
                                {!action.isMatched && <span className="ml-1.5 text-[10px] font-bold text-warn">미연동</span>}
                              </p>
                              <p className="text-[11px] text-ink-mute font-semibold truncate">{action.categoryId} · {action.groupName}</p>
                            </div>
                            <p className="shrink-0 font-bold text-down">-{formatMoney(action.amountKRW, 'KRW')}</p>
                          </div>
                        ))}
                        {targetRebalancePlan.sells.length === 0 && (
                          <p className="text-xs font-semibold text-ink-mute">매도가 필요한 종목이 없습니다.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {targetViewMode === 'chart' && (
                <div className="p-5 md:p-7 border-b border-line grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {[
                    {
                      title: selectedTargetGroupGuide
                        ? `${selectedTargetGroupGuide.name || '미분류'} 현재 보유`
                        : selectedTargetGuide
                          ? `${selectedTargetGuide.id} 현재 보유`
                          : '현재 포트폴리오',
                      data: selectedTargetGuide ? targetCurrentDrilldownChartData : targetCurrentChartData,
                      center: selectedTargetGroupGuide
                        ? formatMoney(selectedTargetGroupGuide.currentValue, 'KRW')
                        : selectedTargetGuide
                          ? formatMoney(selectedTargetGuide.currentValue, 'KRW')
                          : formatMoney(totalConvertedKRW, 'KRW'),
                      drilldown: true,
                    },
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
                      showBackButton: true,
                    },
                  ].map((chart) => (
                    <div key={chart.title} className="bg-canvas rounded-2xl p-5 md:p-6">
                      <div className="flex items-center justify-between gap-3 mb-5">
                        <h4 className="text-sm md:text-base font-bold text-ink">{chart.title}</h4>
                        {chart.showBackButton && selectedTargetGuide ? (
                          <button
                            onClick={() => {
                              if (selectedTargetGroupGuide) {
                                setSelectedTargetGroup(null);
                              } else {
                                setSelectedTargetCategory(null);
                              }
                            }}
                            className="text-[12px] font-bold text-ink-soft bg-canvas px-3 py-1.5 rounded-xl flex items-center gap-1"
                          >
                            <ArrowLeft size={12} /> {selectedTargetGroupGuide ? '폴더 목록' : '전체 목표'}
                          </button>
                        ) : (
                          <span className="text-[12px] font-bold text-ink-mute">{chart.center}</span>
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
                            <span className="text-[12px] font-bold text-ink-mute">
                              {selectedTargetGroupGuide && chart.drilldown ? selectedTargetGroupGuide.name : selectedTargetGuide && chart.drilldown ? selectedTargetGuide.id : 'Total'}
                            </span>
                            <span className="text-sm font-bold text-ink mt-1">{chart.center}</span>
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
                              className={`w-full flex items-center justify-between gap-3 bg-surface rounded-xl px-4 py-3 text-left ${chart.drilldown && !selectedTargetGroupGuide ? 'hover:text-ink transition-colors' : ''}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                <span className="text-xs font-bold text-ink-soft truncate">{item.name}</span>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-bold text-ink">{item.percent.toFixed(1)}%</p>
                                <p className="text-[12px] font-bold text-ink-mute">{formatMoney(item.value, 'KRW')}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {targetViewMode === 'chart' && (
                <div className="p-5 md:p-7 border-b border-line">
                  <h4 className="text-sm md:text-base font-bold text-ink mb-1">카테고리별 현재 vs 목표 비중</h4>
                  <p className="text-[11px] md:text-xs font-semibold text-ink-mute mb-5">두 파이그래프만으로는 비교하기 어려운 차이를 막대로 바로 보여줍니다.</p>
                  <div className="space-y-5">
                    {targetPortfolioGuide.map((category) => {
                      const currentPct = Math.max(0, Math.min(100, category.currentPercent));
                      const targetPct = Math.max(0, Math.min(100, Number(category.percent) || 0));
                      const gapPercentPoint = category.currentPercent - targetPct;
                      return (
                        <div key={category.id}>
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <span className="text-xs md:text-sm font-bold text-ink">{category.id}</span>
                            {Math.abs(gapPercentPoint) > 0.05 && (
                              <span className="text-[11px] md:text-xs font-bold text-ink-mute">
                                목표 대비 {gapPercentPoint > 0 ? '+' : ''}{gapPercentPoint.toFixed(1)}%p
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="w-9 shrink-0 text-[10px] font-bold text-ink-mute">현재</span>
                              <div className="flex-1 h-2.5 rounded-full bg-line-soft overflow-hidden">
                                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(currentPct, currentPct > 0 ? 1 : 0)}%` }} />
                              </div>
                              <span className="w-14 shrink-0 text-right text-[11px] font-bold text-ink">{category.currentPercent.toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-9 shrink-0 text-[10px] font-bold text-ink-mute">목표</span>
                              <div className="flex-1 h-2.5 rounded-full bg-line-soft overflow-hidden">
                                <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(targetPct, targetPct > 0 ? 1 : 0)}%` }} />
                              </div>
                              <span className="w-14 shrink-0 text-right text-[11px] font-bold text-ink">{targetPct.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {targetPortfolioGuide.length === 0 && (
                      <p className="text-xs font-bold text-ink-mute">분류를 추가하면 여기에 비교 막대가 표시됩니다.</p>
                    )}
                  </div>
                </div>
              )}

              {targetViewMode === 'table' && (
              <div className="divide-y divide-line-soft">
                {targetPortfolioGuide.map((category) => (
                  <div key={category.id} className="p-5 md:p-7 space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr_auto] gap-3 lg:items-end">
                      <div>
                        <p className="text-sm md:text-base font-bold text-ink">{category.id}</p>
                        <p className="text-[12px] md:text-xs font-bold text-ink-mute mt-1">
                          현재 {category.currentPercent.toFixed(1)}% / 목표 {Number(category.percent || 0).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <label htmlFor="app-field-3" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                          목표 비중
                        </label>
                        <input id="app-field-3"
                          inputMode="decimal"
                          value={category.percent}
                          onChange={(e) => updateTargetCategoryPercent(category.id, e.target.value)}
                          className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand text-sm font-bold text-ink"
                        />
                      </div>
                      <button
                        onClick={() => removeTargetCategory(category.id)}
                        className="px-4 py-3 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors justify-self-start lg:justify-self-end"
                        title="분류 삭제"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-canvas rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">현재 가치</p>
                        <p className="text-lg font-bold text-ink">{formatMoney(category.currentValue, 'KRW')}</p>
                      </div>
                      <div className="bg-canvas rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">목표 가치</p>
                        <p className="text-lg font-bold text-ink">{formatMoney(category.targetValue, 'KRW')}</p>
                      </div>
                      <div className="bg-canvas rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">{category.gapValue >= 0 ? '추가 필요 금액' : '목표 초과 금액'}</p>
                        <p className={`text-lg font-bold ${category.gapValue >= 0 ? 'text-up' : 'text-down'}`}>
                          {formatMoney(Math.abs(category.gapValue), 'KRW')}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs md:text-sm font-bold text-ink">분류 안 폴더 목표</p>
                          <p className={`text-[12px] md:text-xs font-bold mt-1 ${Math.abs(category.groupTotalPercent - 100) < 0.001 || category.groups.length === 0 ? 'text-ink-mute' : 'text-warn'}`}>
                            폴더 목표 합계 {category.groupTotalPercent.toFixed(1)}%
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {Math.abs(category.groupTotalPercent - 100) >= 0.001 && category.groups.length > 0 && (
                            <button
                              onClick={() => normalizeGroupPercents(category.id)}
                              className="px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs hover:bg-line transition-colors"
                              title="지금 넣은 비율은 유지한 채 합만 100%로 맞춥니다"
                            >
                              100%로 맞추기
                            </button>
                          )}
                          <button
                            onClick={() => addTargetGroup(category.id)}
                            className="px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-line transition-colors"
                          >
                            <Plus size={14} /> 폴더 추가
                          </button>
                        </div>
                      </div>

                      {category.groups.map((group) => (
                        <div key={group.id} className="bg-canvas rounded-2xl p-4 md:p-5 space-y-3">
                          <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.5fr_auto_auto] gap-2 lg:items-center">
                            <div className="flex items-center gap-2 min-w-0">
                              <Folder size={17} className="text-ink-soft shrink-0" />
                              <input
                                value={group.name}
                                onChange={(e) => updateTargetGroup(category.id, group.id, { name: e.target.value })}
                                placeholder="폴더명 예: 빅테크"
                                className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                              />
                            </div>
                            <input
                              inputMode="decimal"
                              value={group.percent}
                              onChange={(e) => updateTargetGroup(category.id, group.id, { percent: sanitizeNumericInput(e.target.value) })}
                              placeholder="폴더 비중 %"
                              className="px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                            />
                            <button
                              onClick={() => addTargetItem(category.id, group.id)}
                              className="px-3 py-2.5 bg-canvas text-ink-soft rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-canvas transition-colors"
                            >
                              <Plus size={13} /> 종목
                            </button>
                            <button
                              onClick={() => removeTargetGroup(category.id, group.id)}
                              className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
                              title="폴더 삭제"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[12px] md:text-xs font-bold">
                            <span className="bg-surface rounded-xl px-3 py-2 text-ink-soft">폴더 목표 {Number(group.percent || 0).toFixed(1)}%</span>
                            <span className="bg-surface rounded-xl px-3 py-2 text-ink">목표 {formatMoney(group.targetValue, 'KRW')}</span>
                            <span className="bg-surface rounded-xl px-3 py-2 text-ink-soft">현재 {formatMoney(group.currentValue, 'KRW')}</span>
                            {Math.abs(group.itemTotalPercent - 100) >= 0.001 && group.items.length > 0 ? (
                              <button
                                onClick={() => normalizeItemPercents(category.id, group.id)}
                                className="bg-warn-soft text-warn rounded-xl px-3 py-2 text-left hover:opacity-80 transition-opacity"
                                title="지금 넣은 비율은 유지한 채 합만 100%로 맞춥니다"
                              >
                                종목 합계 {group.itemTotalPercent.toFixed(1)}% · 100%로 맞추기
                              </button>
                            ) : (
                              <span className="text-ink-soft bg-surface rounded-xl px-3 py-2">
                                종목 합계 {group.itemTotalPercent.toFixed(1)}%
                              </span>
                            )}
                          </div>

                          <div className="space-y-2 pl-3 md:pl-5 border-l-2 border-line">
                            {group.items.map((item) => (
                              <div key={item.id} className="grid grid-cols-1 lg:grid-cols-[1fr_0.8fr_0.55fr_0.8fr_auto] gap-2 bg-surface rounded-2xl p-3">
                                <div className="relative">
                                  <input
                                    value={item.name}
                                    onChange={(e) => updateTargetItem(category.id, group.id, item.id, { name: e.target.value })}
                                    placeholder="종목명"
                                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                                  />
                                  {!item.isMatched && (item.name || item.ticker) && (
                                    <span
                                      className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-warn-soft text-warn text-[9px] font-bold"
                                      title="현재 보유 종목과 자동으로 매칭되지 않았습니다. 종목명 또는 티커를 확인하세요."
                                    >
                                      미연동
                                    </span>
                                  )}
                                </div>
                                <input
                                  value={item.ticker}
                                  onChange={(e) => updateTargetItem(category.id, group.id, item.id, { ticker: e.target.value.toUpperCase() })}
                                  placeholder="티커"
                                  className="px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                                />
                                <input
                                  inputMode="decimal"
                                  value={item.percent}
                                  onChange={(e) => updateTargetItem(category.id, group.id, item.id, { percent: sanitizeNumericInput(e.target.value) })}
                                  placeholder="%"
                                  className="px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                                />
                                <div className="px-3 py-2.5 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink-soft">
                                  {item.currentPriceKRW > 0 ? (
                                    <>
                                      <span className="block text-[11px] font-bold text-ink-mute">자동 현재가</span>
                                      <span>{formatMoney(item.currentPriceKRW, 'KRW')}</span>
                                      {item.currency && item.currency !== 'KRW' && (
                                        <span className="block text-[12px] text-ink-soft mt-0.5">{formatMoney(item.currentPriceNative, item.currency)}</span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-ink-mute">티커 입력 시 자동 연동</span>
                                  )}
                                </div>
                                <button
                                  onClick={() => removeTargetItem(category.id, group.id, item.id)}
                                  className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
                                  title="종목 삭제"
                                >
                                  <Trash2 size={15} />
                                </button>
                                <div className="lg:col-span-5 grid grid-cols-1 md:grid-cols-4 gap-2 text-[12px] md:text-xs font-bold">
                                  <span className="bg-canvas rounded-xl px-3 py-2 text-ink-soft">현재 {formatMoney(item.currentValue, 'KRW')}</span>
                                  <span className="bg-canvas rounded-xl px-3 py-2 text-ink">목표 {formatMoney(item.targetValue, 'KRW')}</span>
                                  <span className={`bg-canvas rounded-xl px-3 py-2 ${item.gapValue >= 0 ? 'text-up' : 'text-down'}`}>
                                    {item.gapValue >= 0 ? '추가 필요' : '목표 초과'} {formatMoney(Math.abs(item.gapValue), 'KRW')}
                                  </span>
                                  <span className={`bg-canvas rounded-xl px-3 py-2 ${
                                    item.adjustmentSide === 'buy'
                                      ? 'text-up'
                                      : item.adjustmentSide === 'sell'
                                        ? 'text-down'
                                        : 'text-ink-soft'
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
                              <p className="px-3 py-4 text-xs font-bold text-ink-mute">이 폴더에 종목을 추가하세요.</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {category.unassignedAssets.length > 0 && (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs md:text-sm font-bold text-ink">계획에 없는 보유 종목</p>
                          <p className="text-[12px] md:text-xs font-bold text-warn mt-1">
                            이 분류에 속하지만 목표 계획(폴더·종목)에 연결되지 않은 보유 자산입니다 · 합계 {formatMoney(category.unassignedValue, 'KRW')}
                          </p>
                        </div>
                        <div className="space-y-2">
                          {category.unassignedAssets.map((asset) => (
                            <div key={asset.id || `${asset.name}-${asset.ticker}`} className="flex items-center justify-between gap-3 bg-warn-soft/40 rounded-xl px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-xs md:text-sm font-bold text-ink truncate">{asset.name}</p>
                                {asset.ticker && <p className="text-[11px] font-bold text-ink-mute mt-0.5">{asset.ticker}</p>}
                              </div>
                              <p className="text-xs md:text-sm font-bold text-ink-soft shrink-0">{formatMoney(asset.currentKRW, 'KRW')}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-6 anim-fade">
          <div className="bg-surface rounded-[20px] overflow-hidden">
            <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-base md:text-lg font-bold text-ink flex items-center gap-2">
                  <CalendarDays size={18} className="text-ink-soft" />
                  배당 캘린더
                </h3>
                <FeatureInfo text="공시 지급일은 한국시간 기준이며, 향후 배당락일은 최근 주기로 추정합니다." />
              </div>
              <div className="seg flex items-center gap-0.5 p-1 rounded-[14px]">
                <button
                  onClick={() => setCalendarMonth(getMonthKey(addMonthsClamped(new Date(`${calendarMonth}-01T00:00:00`), -1)))}
                  aria-label="이전 달"
                  className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink hover:bg-surface"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="px-3 min-w-24 text-center text-xs md:text-sm font-bold text-ink tabular-nums">
                  {calendarMonth}
                </div>
                <button
                  onClick={() => setCalendarMonth(getMonthKey(addMonthsClamped(new Date(`${calendarMonth}-01T00:00:00`), 1)))}
                  aria-label="다음 달"
                  className="seg-item w-9 h-9 grid place-items-center rounded-[10px] text-ink-mute hover:text-ink hover:bg-surface"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 md:px-7 md:py-5 border-b border-line bg-canvas/60 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-[12px] md:text-xs font-bold text-ink-mute">
                  {calendarMonth.replace('-', '년 ')}월 세후 예상 배당 합계
                </p>
                <p className="text-[11px] md:text-[12px] font-semibold text-ink-mute mt-1">
                  지급 확정 {dividendCalendarMonthlySummary.confirmedCount.toLocaleString()}건 · 예상 {dividendCalendarMonthlySummary.estimatedCount.toLocaleString()}건 · 통화별 합계
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {dividendCalendarMonthlySummary.totals.length > 0 ? (
                  dividendCalendarMonthlySummary.totals.map(({ currency, amount }) => (
                    <span key={currency} className="figure px-3 py-2 rounded-xl bg-surface border border-line-soft text-sm md:text-base font-bold text-ink">
                      {formatMoney(amount, currency)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs md:text-sm font-bold text-ink-mute">예정 금액 없음</span>
                )}
              </div>
            </div>

            <div className="p-4 md:p-7">
              <div className="grid grid-cols-7 gap-1.5 md:gap-2 mb-2">
                {CALENDAR_WEEKDAYS.map((weekday, weekdayIndex) => (
                  <div
                    key={weekday}
                    className={`text-center text-[11px] md:text-[12px] font-bold tracking-[0.06em] py-2 ${weekdayIndex === 0 ? 'text-up/70' : weekdayIndex === 6 ? 'text-down/70' : 'text-ink-mute'}`}
                  >
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
                      className={`min-h-20 md:min-h-28 rounded-xl border p-2 transition-colors ${cell.isCurrentMonth ? 'bg-surface border-line-soft' : 'bg-canvas/50 border-transparent text-ink-mute'}`}
                    >
                      <div className={`text-[12px] md:text-xs font-semibold mb-1.5 tabular-nums ${cell.isCurrentMonth ? 'text-ink-soft' : 'text-ink-mute/70'}`}>
                        {cell.day}
                      </div>
                      <div className="space-y-1">
                        {events.slice(0, 3).map((event) => (
                          <button
                            key={event.id}
                            onClick={() => setSelectedCalendarEventId(event.id)}
                            title={`${event.name} 세전 ${formatMoney(event.grossAmount, event.currency)} / 세후 ${formatMoney(event.netAmount, event.currency)}`}
                            className={`w-full truncate rounded-md px-1.5 py-1 text-[11px] md:text-[12px] font-semibold text-left transition-all ${selectedCalendarEvent?.id === event.id ? 'bg-ink text-surface shadow-card' : event.isEstimated ? 'bg-brand-soft text-ink-soft hover:bg-line' : 'bg-up-soft text-up hover:brightness-95'}`}
                          >
                            {event.name}
                          </button>
                        ))}
                        {events.length > 3 && (
                          <button
                            type="button"
                            onClick={() => setExpandedCalendarDate((previous) => (
                              previous === cell.dateKey ? '' : cell.dateKey
                            ))}
                            aria-expanded={expandedCalendarDate === cell.dateKey}
                            aria-label={`${cell.dateKey} 배당 일정 ${events.length - 3}건 더 보기`}
                            className={`block w-full rounded-md px-1 py-0.5 text-left text-[11px] font-bold transition-colors ${expandedCalendarDate === cell.dateKey ? 'bg-ink text-surface' : 'text-ink-mute hover:bg-canvas hover:text-ink'}`}
                          >
                            +{events.length - 3} 더보기
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {expandedCalendarEvents.length > 0 && (
                <div className="mt-4 md:mt-5 rounded-2xl border border-line bg-surface p-4 md:p-5 shadow-card">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="text-[11px] md:text-[12px] font-bold text-ink-mute">선택한 날짜의 전체 배당 일정</p>
                      <h4 className="text-sm md:text-base font-bold text-ink mt-0.5">
                        {expandedCalendarDate} · {expandedCalendarEvents.length.toLocaleString()}건
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedCalendarDate('')}
                      aria-label="날짜별 전체 일정 닫기"
                      className="p-2 rounded-full bg-canvas text-ink-mute hover:text-ink transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {expandedCalendarEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => setSelectedCalendarEventId(event.id)}
                        className={`rounded-xl border p-3 text-left transition-colors ${selectedCalendarEvent?.id === event.id ? 'border-ink bg-ink text-surface' : 'border-line-soft bg-canvas hover:border-line'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-xs md:text-sm truncate">{event.name}</p>
                            <p className={`text-[11px] font-semibold mt-1 ${selectedCalendarEvent?.id === event.id ? 'text-surface/70' : 'text-ink-mute'}`}>
                              {event.dateLabel} · {event.isEstimated ? '예상' : '확정'}
                            </p>
                          </div>
                          <span className={`figure shrink-0 text-xs md:text-sm font-bold ${selectedCalendarEvent?.id === event.id ? 'text-surface' : 'text-up'}`}>
                            {formatMoney(event.netAmount, event.currency)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 md:mt-6 bg-canvas rounded-2xl p-5 md:p-6">
                {selectedCalendarEvent ? (
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-[12px] md:text-xs font-bold text-ink-mute mb-1">{selectedCalendarEvent.dateLabel} {selectedCalendarEvent.date}</p>
                      <h4 className="text-lg md:text-xl font-bold text-ink">{selectedCalendarEvent.name}</h4>
                      <p className="text-xs md:text-sm font-bold text-ink-soft mt-1">{selectedCalendarEvent.ticker} · {selectedCalendarEvent.quantity.toLocaleString()}주 기준</p>
                      <p className="text-[11px] md:text-xs font-bold text-ink-mute mt-1">
                        배당기준일 {selectedCalendarEvent.eligibilityDate || selectedCalendarEvent.date}
                      </p>
                      <p className="text-[11px] md:text-xs font-bold text-ink-mute mt-1">
                        배당지급일 {selectedCalendarEvent.officialPaymentDate || '미정'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 min-w-full md:min-w-80">
                      <div className="bg-surface border border-line-soft rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">{selectedCalendarEvent.isEstimated ? '세전 예상' : '세전'}</p>
                        <p className="figure text-base md:text-lg font-bold text-ink">{formatMoney(selectedCalendarEvent.grossAmount, selectedCalendarEvent.currency)}</p>
                      </div>
                      <div className="bg-surface border border-line-soft rounded-xl p-4">
                        <p className="text-[12px] font-bold text-ink-mute mb-1">{selectedCalendarEvent.isEstimated ? '세후 예상' : '세후'}</p>
                        <p className="figure text-base md:text-lg font-bold text-up">{formatMoney(selectedCalendarEvent.netAmount, selectedCalendarEvent.currency)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-xs md:text-sm font-bold text-ink-mute">이번 달에 표시할 배당 일정이 없습니다.</p>
                )}
              </div>
            </div>
          </div>
          <AnnualDividendTrend
            key={annualDividendYear}
            year={annualDividendYear}
            trend={annualDividendTrend}
            isFxLoading={annualDividendFxLookupDates.length > 0}
            onYearChange={setAnnualDividendYear}
          />
          </div>
        )}
      </div>

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
        <ModalOverlay overlayClassName="z-[110]" labelledBy="dividend-entry-title" onClose={() => setIsAddingDividend(false)}>
          <div className="bg-surface w-full max-w-[440px] max-h-[90vh] overflow-y-auto scroll-soft rounded-t-[24px] md:rounded-[24px] p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <h3 id="dividend-entry-title" className="text-lg md:text-xl font-bold text-ink">실제 입금 배당 추가</h3>
                <FeatureInfo text="증권사에 들어온 세후 금액을 그대로 입력합니다." align="right" />
              </div>
              <button
                type="button"
                onClick={() => setIsAddingDividend(false)}
                className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="app-field-4" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">종목</label>
                <select id="app-field-4"
                  value={actualDividendForm.assetId}
                  onChange={(event) => handleActualDividendAssetChange(event.target.value)}
                  className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                >
                  <option value="">종목 선택</option>
                  {dividendEntryAssets.map((asset) => (
                    <option key={asset.id} value={String(asset.id)}>{asset.name} · {asset.ticker || asset.currency}</option>
                  ))}
                  <option value="__manual__">목록에 없는 종목 직접 입력</option>
                </select>
              </div>

              {actualDividendForm.assetId === '__manual__' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="app-field-5" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">종목명</label>
                    <input id="app-field-5"
                      value={actualDividendForm.name}
                      onChange={(event) => setActualDividendForm((previous) => ({ ...previous, name: event.target.value }))}
                      placeholder="예: QUALCOMM"
                      className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="app-field-6" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">티커</label>
                    <input id="app-field-6"
                      value={actualDividendForm.ticker}
                      onChange={(event) => setActualDividendForm((previous) => ({ ...previous, ticker: event.target.value.toUpperCase() }))}
                      placeholder="예: QCOM"
                      className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink uppercase"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="app-field-7" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">입금일</label>
                  <input id="app-field-7"
                    type="date"
                    value={actualDividendForm.date}
                    onChange={(event) => setActualDividendForm((previous) => ({ ...previous, date: event.target.value }))}
                    className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                  />
                </div>
                <div>
                  <label htmlFor="app-field-8" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">통화</label>
                  <select id="app-field-8"
                    value={actualDividendForm.currency}
                    onChange={(event) => setActualDividendForm((previous) => ({
                      ...previous,
                      currency: event.target.value,
                      category: previous.assetId === '__manual__'
                        ? (event.target.value === 'KRW' ? '국내주식' : '해외주식')
                        : previous.category,
                    }))}
                    className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                  >
                    <option value="KRW">KRW</option>
                    <option value="USD">USD</option>
                    <option value="JPY">JPY</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="app-field-9" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">실제 입금액</label>
                  <input id="app-field-9"
                    inputMode="decimal"
                    value={formatInputNumber(actualDividendForm.amount)}
                    onChange={(event) => setActualDividendForm((previous) => ({ ...previous, amount: sanitizeNumericInput(event.target.value) }))}
                    placeholder="0"
                    className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                  />
                </div>
                <div>
                  <label htmlFor="app-field-10" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">기준 수량</label>
                  <input id="app-field-10"
                    inputMode="decimal"
                    value={formatInputNumber(actualDividendForm.quantity)}
                    onChange={(event) => setActualDividendForm((previous) => ({ ...previous, quantity: sanitizeNumericInput(event.target.value) }))}
                    placeholder="선택"
                    className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingDividend(false)}
                  className="h-[52px] bg-line-soft text-ink-soft rounded-2xl font-bold text-sm hover:bg-line transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleAddActualDividend}
                  className="h-[52px] bg-brand text-white rounded-2xl font-bold text-sm hover:opacity-90 transition-opacity"
                >
                  실제 입금 반영
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* 자산 추가 모달 */}
{isAdding && (
  <ModalOverlay overlayClassName="z-[100]" labelledBy="add-asset-title" onClose={() => setIsAdding(false)}>
    <div className="bg-surface w-full max-w-[440px] rounded-t-[24px] md:rounded-[24px] p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise max-h-[88vh] overflow-y-auto scroll-soft">
      <div className="flex justify-between items-center mb-6 md:mb-8 sticky top-0 bg-surface z-10 pt-2 pb-2">
        <h3 id="add-asset-title" className="text-lg md:text-xl font-bold text-ink">새 자산 등록</h3>
        <button
          onClick={() => {
            setIsAdding(false);
          }}
          className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <div>
            <label htmlFor="app-field-11" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              자산 구분
            </label>
            <select id="app-field-11"
              className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
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
            <label htmlFor="app-field-12" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              통화 (Currency)
            </label>
            <select id="app-field-12"
              className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
              value={newAsset.currency}
              onChange={(e) => setNewAsset({ ...newAsset, currency: e.target.value })}
            >
              <option value="KRW">원화 (KRW)</option>
              <option value="USD">달러 (USD)</option>
              <option value="JPY">엔화 (JPY)</option>
            </select>
            {/* 해외주식·원자재는 티커를 보고 통화가 자동으로 정해진다.
                여기서 원화를 골라도 달러로 저장되므로, 실제로 쓰일 통화를 분명히 알려준다. */}
            {(() => {
              const resolvedCurrency = getAssetInputCurrency(newAsset.category, newAsset.ticker, newAsset.currency);
              if (resolvedCurrency === newAsset.currency) return null;
              return (
                <p className="mt-1.5 ml-1 text-[11px] font-bold text-ink-mute leading-relaxed">
                  {newAsset.category}은 {getCurrencySymbol(resolvedCurrency)} {resolvedCurrency}로 저장됩니다.
                  단가는 아래에서 원화로도 입력할 수 있어요.
                </p>
              );
            })()}
          </div>
        </div>

        <div className="relative">
          <label className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            {newAsset.category === '현금' ? '계좌명' : '종목명'}
          </label>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-3.5 text-ink-mute" />
            <input
              type="text"
              className="w-full pl-11 pr-4 py-2.5 md:py-3 bg-canvas rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm"
              value={newAsset.name}
              onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
            />
          </div>
        </div>

        {newAsset.category !== '현금' && (
          <div>
            <label htmlFor="app-field-13" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              티커 심볼
            </label>
            <input id="app-field-13"
              type="text"
              className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={newAsset.ticker}
              onChange={(e) => setNewAsset({ ...newAsset, ticker: e.target.value.toUpperCase() })}
            />
          </div>
        )}

        {newAsset.category !== '현금' && (
          <div>
            <label htmlFor="app-field-14" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              보유 계좌
            </label>
            <select id="app-field-14"
              className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={newAsset.accountType}
              onChange={(e) => setNewAsset({
                ...newAsset,
                accountType: normalizeAccountType(e.target.value),
              })}
            >
              {ACCOUNT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-1.5 ml-1 text-[11px] font-bold text-ink-mute leading-relaxed">
              배당은 같은 공식 분배금이라도 계좌 유형에 따라 즉시 원천징수 여부가 달라집니다.
            </p>
          </div>
        )}

        {newAsset.category !== '현금' && (() => {
          // 실제로 저장될 통화. 해외주식/원자재는 사용자가 통화 칸에서 무엇을 골랐든 달러(또는 엔)로 잡힌다.
          const nativeCurrency = getAssetInputCurrency(newAsset.category, newAsset.ticker, newAsset.currency);
          const isForeign = nativeCurrency !== 'KRW';
          const isKrwInput = isForeign && newAsset.priceInputCurrency === 'KRW';
          const inputCurrency = isKrwInput ? 'KRW' : nativeCurrency;

          return (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5 ml-1">
                <label className="block text-[11px] md:text-[12px] font-bold text-ink-mute">
                  평균 단가 ({getCurrencySymbol(inputCurrency)})
                </label>
                {isForeign && (
                  <PriceInputCurrencyToggle
                    nativeCurrency={nativeCurrency}
                    value={newAsset.priceInputCurrency}
                    onChange={(next) => setNewAsset({ ...newAsset, priceInputCurrency: next })}
                  />
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
                value={formatInputNumber(newAsset.averagePrice)}
                onChange={(e) =>
                  setNewAsset({
                    ...newAsset,
                    averagePrice: sanitizeNumericInput(e.target.value)
                  })
                }
              />
            </div>
          );
        })()}

        <div className={newAsset.category === '현금' ? 'col-span-2' : ''}>
          <label htmlFor="app-field-15" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            {newAsset.category === '현금' ? `금액 (${newAsset.currency})` : '매수 수량'}
          </label>
          <input id="app-field-15"
            type="text"
            inputMode="decimal"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
            value={formatInputNumber(newAsset.quantity)}
            onChange={(e) =>
              setNewAsset({
                ...newAsset,
                quantity: sanitizeNumericInput(e.target.value)
              })
            }
          />
        </div>

        <div className="border-t border-line pt-4 mt-2">
          <div>
            <label htmlFor="app-field-16" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
              매수일
            </label>
            <input id="app-field-16"
              type="date"
              className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
              value={newAsset.buyDate}
              onChange={(e) => setNewAsset({ ...newAsset, buyDate: e.target.value })}
            />
          </div>

          {newAsset.category !== '현금' && (
            <div className="mt-4">
              <BrokerFeeFields
                idPrefix="add-asset"
                label="매수 수수료"
                category={newAsset.category}
                currency={newAssetFeeCurrency}
                brokerId={newAsset.brokerId}
                feeRatePercent={newAsset.brokerFeeRate}
                feeAmount={newAsset.brokerFeeAmount}
                feeMode={newAsset.feeMode}
                estimatedFee={newAssetBuyFeePreview}
                onChange={(next) => setNewAsset((prev) => ({ ...prev, ...next }))}
              />
            </div>
          )}

        </div>


        {/* 위 입력 묶음(space-y-4) 바깥이라 간격이 없었다. 같은 1rem을 직접 준다. */}
        <div className="mt-4">
          <label htmlFor="app-field-17" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            매수 메모
          </label>
          <textarea id="app-field-17"
            rows="3"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none"
            value={newAsset.memo}
            onChange={(e) => setNewAsset({ ...newAsset, memo: e.target.value })}
          />
        </div>
        <button
          onClick={handleAddAsset}
          className="w-full mt-7 h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
        >
          포트폴리오에 반영하기
        </button>
      </div>
    </div>
  </ModalOverlay>
)}

{/* 매수 기록 관리 모달 */}
{selectedAssetToManageBuys && (() => {
  return (
  <ModalOverlay overlayClassName="z-[105]" labelledBy="manage-buys-title" onClose={closeBuyLotsModal}>
    <div className="bg-surface w-full max-w-4xl h-[92dvh] md:h-auto md:max-h-[92dvh] rounded-t-[24px] md:rounded-[24px] shadow-modal anim-rise flex flex-col overflow-hidden">
      <div className="flex justify-between items-start gap-4 px-6 pt-6 md:px-7 md:pt-7 mb-5 md:mb-6 shrink-0">
        <div className="min-w-0">
          <h3 id="manage-buys-title" className="text-lg md:text-xl font-bold text-ink truncate">
            {selectedAssetToManageBuys.name} 매수 기록
          </h3>
          <p className="text-[12px] md:text-xs text-ink-mute font-bold mt-1 truncate">
            {selectedAssetToManageBuys.ticker || '-'} · {buyLotDrafts.length.toLocaleString()}개 기록
          </p>
        </div>
        <button
          onClick={closeBuyLotsModal}
          className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-3 px-6 md:px-7 mb-4 md:mb-5 shrink-0">
        <div className="rounded-xl bg-canvas px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[11px] md:text-[11px] font-bold text-ink-mute">총 매수수량</p>
          <p className="mt-1 text-sm md:text-base font-bold text-ink">
            {buyLotDraftSummary.totalQuantity.toLocaleString()}{selectedAssetToManageBuys.category === '원자재' ? '단위' : '주'}
          </p>
        </div>
        <div className="rounded-xl bg-canvas px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[11px] md:text-[11px] font-bold text-ink-mute">평단</p>
          <p className="mt-1 text-sm md:text-base font-bold text-ink">
            {formatMoney(buyLotDraftSummary.averagePrice, selectedAssetToManageBuys.currency)}
          </p>
        </div>
        <div className="rounded-xl bg-canvas px-3 py-2.5 md:px-4 md:py-3">
          <p className="text-[11px] md:text-[11px] font-bold text-ink-mute">최초 매수일</p>
          <p className="mt-1 text-sm md:text-base font-bold text-ink">
            {buyLotDrafts.map(lot => lot.date).filter(Boolean).sort()[0] || '-'}
          </p>
          {buyLotDraftSummary.totalBuyFee > 0 && (
            <p className="text-[11px] font-bold text-ink-mute mt-1">
              매수 수수료 {formatMoney(buyLotDraftSummary.totalBuyFee, selectedAssetToManageBuys.currency)}
            </p>
          )}
        </div>
      </div>

      <div className="mx-6 md:mx-7 hairline rounded-xl bg-canvas px-3 py-3 md:px-4 md:py-3.5 mb-4 md:mb-5 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div>
            <label htmlFor="buy-lots-account-type" className="block text-[11px] font-bold text-ink-mute mb-1">보유 계좌</label>
            <p id="buy-lots-account-type-hint" className="text-[11px] md:text-[12px] font-bold text-ink-mute leading-relaxed">
              ISA·연금계좌는 국내 상장 ETF 분배금의 즉시 원천징수를 유예합니다.
            </p>
          </div>
          <select
            id="buy-lots-account-type"
            aria-describedby="buy-lots-account-type-hint"
            className="w-full sm:w-40 px-3 h-11 bg-surface rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
            value={accountTypeDraft}
            onChange={(event) => setAccountTypeDraft(normalizeAccountType(event.target.value))}
          >
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-soft px-6 md:px-7 pb-4">
        <div className="hidden md:grid grid-cols-[1.05fr_1fr_1fr_0.7fr_1fr_44px] gap-3 px-2 pb-2 text-[11px] font-bold text-ink-mute">
          <span>매수일</span>
          <span className="text-right">단가</span>
          <span className="text-right">수량</span>
          <span className="text-right">수수료</span>
          <span className="text-right">매수금액</span>
          <span></span>
        </div>
        <div className="space-y-3">
          {buyLotDrafts.map((lot, index) => {
            const lotQuantity = parseNumber(lot.quantity);
            const lotPrice = parseNumber(lot.price);
            const lotAmount = lotQuantity * lotPrice;

            return (
              <div key={lot.draftId} className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr_1fr_0.7fr_1fr_44px] gap-2 md:gap-3 items-end rounded-xl bg-canvas bg-canvas/70 p-3">
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-date`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">매수일</label>
                  <input
                    id={`buy-lot-${lot.draftId}-date`}
                    aria-label={`${index + 1}번째 매수 기록의 매수일`}
                    type="date"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
                    value={lot.date}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'date', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-price`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">단가</label>
                  <input
                    id={`buy-lot-${lot.draftId}-price`}
                    aria-label={`${index + 1}번째 매수 기록의 단가`}
                    type="text"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.price)}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'price', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-quantity`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">수량</label>
                  <input
                    id={`buy-lot-${lot.draftId}-quantity`}
                    aria-label={`${index + 1}번째 매수 기록의 수량`}
                    type="text"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.quantity)}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'quantity', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor={`buy-lot-${lot.draftId}-fee`} className="md:hidden block text-[11px] font-bold text-ink-mute mb-1">매수 수수료</label>
                  <input
                    id={`buy-lot-${lot.draftId}-fee`}
                    aria-label={`${index + 1}번째 매수 기록의 매수 수수료`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm text-right"
                    value={formatInputNumber(lot.brokerFee ?? '')}
                    onChange={(e) => updateBuyLotDraft(lot.draftId, 'brokerFee', sanitizeNumericInput(e.target.value))}
                  />
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-canvas text-right">
                  <p className="md:hidden text-[11px] font-bold text-ink-mute mb-1">매수금액</p>
                  <p className="font-bold text-ink text-xs md:text-sm">
                    {formatMoney(lotAmount, selectedAssetToManageBuys.currency)}
                  </p>
                </div>
                <button
                  onClick={() => removeBuyLotDraft(lot.draftId)}
                  disabled={buyLotDrafts.length <= 1}
                  className="h-10 md:h-11 inline-flex items-center justify-center rounded-xl text-ink-mute hover:text-danger hover:bg-danger-soft disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-mute transition-colors"
                  title={`${index + 1}번째 매수 기록 삭제`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:gap-3 px-6 md:px-7 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-7 border-t border-line-soft bg-surface shrink-0">
        <button
          onClick={addBuyLotDraft}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-line-soft hover:bg-line text-ink-soft rounded-xl font-bold text-xs md:text-sm transition-colors"
        >
          <Plus size={16} /> 매수 기록 추가
        </button>
        <button
          onClick={handleSaveBuyLots}
          className="flex-1 h-12 px-6 bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
        >
          매수 기록 저장하기
        </button>
      </div>
    </div>
  </ModalOverlay>
  );
})()}

{/* 추가 매수 모달 */}
{isUpdatingAsset && selectedAssetToUpdate && (
  <ModalOverlay overlayClassName="z-[110]" labelledBy="update-asset-title" onClose={() => { setIsUpdatingAsset(false); setSelectedAssetToUpdate(null); }}>
    <div className="bg-surface w-full max-w-[440px] rounded-t-[24px] md:rounded-[24px] p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise max-h-[88vh] overflow-y-auto scroll-soft">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <h3 id="update-asset-title" className="text-lg md:text-xl font-bold text-ink">
          {selectedAssetToUpdate.name} 추가 매수
        </h3>
        <button
          onClick={() => {
            setIsUpdatingAsset(false);
            setSelectedAssetToUpdate(null);
          }}
          className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        {(() => {
          const nativeCurrency = selectedAssetToUpdate.currency || 'KRW';
          const isForeign = nativeCurrency !== 'KRW';
          const isKrwInput = isForeign && addBuyForm.priceInputCurrency === 'KRW';
          const inputCurrency = isKrwInput ? 'KRW' : nativeCurrency;

          return (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5 ml-1">
                <label className="block text-[11px] md:text-[12px] font-bold text-ink-mute">
                  추가 매수 단가 ({getCurrencySymbol(inputCurrency)})
                </label>
                {isForeign && (
                  <PriceInputCurrencyToggle
                    nativeCurrency={nativeCurrency}
                    value={addBuyForm.priceInputCurrency}
                    onChange={(next) => setAddBuyForm((prev) => ({ ...prev, priceInputCurrency: next }))}
                  />
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
                value={formatInputNumber(addBuyForm.averagePrice)}
                onChange={(e) =>
                  setAddBuyForm((prev) => ({
                    ...prev,
                    averagePrice: sanitizeNumericInput(e.target.value)
                  }))
                }
              />
            </div>
          );
        })()}

        <div>
          <label htmlFor="app-field-18" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            추가 매수 수량
          </label>
          <input id="app-field-18"
            type="text"
            inputMode="decimal"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
            value={formatInputNumber(addBuyForm.quantity)}
            onChange={(e) =>
              setAddBuyForm((prev) => ({
                ...prev,
                quantity: sanitizeNumericInput(e.target.value)
              }))
            }
          />
        </div>

        <div className="border-t border-line pt-4 mt-2">
          <label htmlFor="app-field-19" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            추가 매수일
          </label>
          <input id="app-field-19"
            type="date"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
            value={addBuyForm.buyDate}
            onChange={(e) =>
              setAddBuyForm((prev) => ({
                ...prev,
                buyDate: e.target.value
              }))
            }
          />

          <div className="mt-4">
            <BrokerFeeFields
              idPrefix="add-buy"
              label="매수 수수료"
              category={selectedAssetToUpdate.category}
              currency={addBuyFeeCurrency}
              brokerId={addBuyForm.brokerId}
              feeRatePercent={addBuyForm.brokerFeeRate}
              feeAmount={addBuyForm.brokerFeeAmount}
              feeMode={addBuyForm.feeMode}
              estimatedFee={addBuyFeePreview}
              onChange={(next) => setAddBuyForm((prev) => ({ ...prev, ...next }))}
            />
          </div>
        </div>
      </div>


        {/* 위 입력 묶음(space-y-4) 바깥이라 간격이 없었다. 같은 1rem을 직접 준다. */}
        <div className="mt-4">
          <label htmlFor="app-field-20" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            매수 메모
          </label>
          <textarea id="app-field-20"
            rows="3"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none"
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
        className="w-full mt-7 h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
      >
        추가 매수 반영하기
      </button>
    </div>
  </ModalOverlay>
)}

{/* 매도 모달 */}
{isSellingAsset && selectedAssetToSell && (
  <ModalOverlay overlayClassName="z-[120]" labelledBy="sell-asset-title" onClose={() => { setIsSellingAsset(false); setSelectedAssetToSell(null); }}>
    <div className="bg-surface w-full max-w-[440px] rounded-t-[24px] md:rounded-[24px] p-6 md:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 shadow-modal anim-rise max-h-[88vh] overflow-y-auto scroll-soft">
      <div className="flex justify-between items-center gap-4 mb-6 md:mb-8">
        <h3 id="sell-asset-title" className="text-lg md:text-xl font-bold text-ink whitespace-nowrap">
          {selectedAssetToSell.name} 매도
        </h3>
        <button
          onClick={() => {
            setIsSellingAsset(false);
            setSelectedAssetToSell(null);
          }}
          className="p-2 bg-canvas hover:bg-line-soft rounded-full transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="app-field-21" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            매도 단가 ({getCurrencySymbol(selectedAssetToSell.currency)})
          </label>
          <input id="app-field-21"
            type="text"
            inputMode="decimal"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
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
          <label htmlFor="app-field-22" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            매도 수량
          </label>
          <input id="app-field-22"
            type="text"
            inputMode="decimal"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-ink text-xs md:text-sm"
            value={formatInputNumber(sellForm.quantity)}
            onChange={(e) =>
              setSellForm((prev) => ({
                ...prev,
                quantity: sanitizeNumericInput(e.target.value)
              }))
            }
          />
        </div>

        <BrokerFeeFields
          idPrefix="sell"
          label="매도 수수료"
          amountOnly
          category={selectedAssetToSell.category}
          currency={selectedAssetToSell.currency}
          brokerId={sellForm.brokerId}
          feeRatePercent={sellForm.brokerFeeRate}
          feeAmount={sellForm.brokerFeeAmount}
          feeMode={sellForm.feeMode}
          estimatedFee={sellFeePreview?.brokerFee || 0}
          onChange={(next) => setSellForm((prev) => ({ ...prev, ...next }))}
        />

        {sellFeePreview && (sellFeePreview.grossSellAmount > 0 || sellFeePreview.grossPnl !== 0) && (
          <div className="receipt rounded-2xl px-4 py-4 md:px-5">
            <p className="eyebrow mb-3">차감 내역</p>

            <div className="space-y-2.5">
              <div className="receipt-row text-xs md:text-sm">
                <span className="font-semibold text-ink-mute">예상 수수료</span>
                <span className="font-bold text-ink-soft">
                  −{formatMoney(sellFeePreview.brokerFee, selectedAssetToSell.currency)}
                </span>
              </div>
              <div className="receipt-row text-xs md:text-sm">
                <span className="font-semibold text-ink-mute">
                  예상 제세금
                  {isDomesticEtfLikeAsset(selectedAssetToSell) ? ' · ETF 면제' : ''}
                </span>
                <span className="font-bold text-ink-soft">
                  −{formatMoney(sellFeePreview.sellTax, selectedAssetToSell.currency)}
                </span>
              </div>
              {sellBuyFeeShare > 0 && (
                <div className="receipt-row text-xs md:text-sm">
                  <span className="font-semibold text-ink-mute">매수 수수료(이번 매도분)</span>
                  <span className="font-bold text-ink-soft">
                    −{formatMoney(sellBuyFeeShare, selectedAssetToSell.currency)}
                  </span>
                </div>
              )}
              <div className="receipt-row text-xs md:text-sm">
                <span className="font-semibold text-ink-mute">총 차감액</span>
                <span className="font-bold text-ink">
                  −{formatMoney(sellFeePreview.totalCost + sellBuyFeeShare, selectedAssetToSell.currency)}
                </span>
              </div>
            </div>

            <div className="receipt-row receipt-total">
              <span className="text-xs md:text-sm font-bold text-ink">차감 후 손익</span>
              <span className={`figure text-lg md:text-xl font-bold ${sellFeePreview.netPnl - sellBuyFeeShare >= 0 ? 'text-up' : 'text-down'}`}>
                {sellFeePreview.netPnl - sellBuyFeeShare >= 0 ? '+' : ''}
                {formatMoney(sellFeePreview.netPnl - sellBuyFeeShare, selectedAssetToSell.currency)}
              </span>
            </div>

            <p className="mt-3 text-[11px] font-medium text-ink-mute leading-relaxed">
              제세금은 매도일 기준 증권거래세율로 자동 계산합니다. 국내 상장 ETF·ETN과 해외 종목은 면제라 0원으로 잡힙니다.
            </p>
          </div>
        )}

        <div className="border-t border-line pt-4 mt-2">
          <label htmlFor="app-field-26" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            매도일
          </label>
          <input id="app-field-26"
            type="date"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink"
            value={sellForm.sellDate}
            onChange={(e) =>
              setSellForm((prev) => ({
                ...prev,
                sellDate: e.target.value,
                sellTaxRate: formatFeeRateInput(getSellTaxRatePercent(selectedAssetToSell, e.target.value)),
              }))
            }
          />
        </div>
      </div>


        {/* 위 입력 묶음(space-y-4) 바깥이라 간격이 없었다. 같은 1rem을 직접 준다. */}
        <div className="mt-4">
          <label htmlFor="app-field-27" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
            매도 메모
          </label>
          <textarea id="app-field-27"
            rows="3"
            className="w-full px-4 h-[52px] bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm resize-none"
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
        className="w-full mt-7 h-[54px] bg-brand text-surface rounded-2xl font-bold text-[15px] hover:bg-brand-strong active:scale-[0.99] transition-all"
      >
        매도 반영하기
      </button>
    </div>
  </ModalOverlay>
      )}

      {assetPendingRemoval && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4 anim-fade"
          onClick={() => setAssetPendingRemoval(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-asset-title"
            className="w-full max-w-[420px] bg-surface rounded-[24px] p-7 shadow-modal anim-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-11 h-11 rounded-2xl bg-danger-soft text-danger flex items-center justify-center mb-4">
              <Trash2 size={20} aria-hidden="true" />
            </div>
            <h2 id="remove-asset-title" className="text-base md:text-lg font-bold text-ink">
              [{assetPendingRemoval.asset.name}] 자산을 삭제할까요?
            </h2>
            <p className="mt-2 text-xs md:text-sm font-medium text-ink-soft leading-relaxed">
              아래 기록이 함께 삭제되며 되돌릴 수 없습니다.
            </p>

            <ul className="mt-4 space-y-1.5 bg-canvas rounded-2xl p-4">
              {[
                { label: '매매 기록', count: assetPendingRemoval.tradeCount },
                { label: '메모', count: assetPendingRemoval.memoCount },
                { label: '매매 원장', count: assetPendingRemoval.ledgerCount },
              ].map(({ label, count }) => (
                <li key={label} className="flex items-center justify-between text-xs md:text-sm">
                  <span className="font-bold text-ink-soft">{label}</span>
                  <span className="font-bold text-ink">{count.toLocaleString()}건</span>
                </li>
              ))}
            </ul>

            {assetPendingRemoval.dividendCount > 0 && (
              <p className="mt-3 text-[13px] md:text-xs font-bold text-ink-mute">
                배당 내역 {assetPendingRemoval.dividendCount.toLocaleString()}건은 통계를 위해 유지됩니다.
              </p>
            )}

            <div className="mt-6 flex gap-2.5">
              <button
                onClick={() => setAssetPendingRemoval(null)}
                className="flex-1 px-5 py-3 min-h-11 bg-line-soft text-ink-soft rounded-xl md:rounded-2xl font-bold text-xs md:text-sm hover:bg-line transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmRemoveAsset}
                className="flex-1 px-5 py-3 min-h-11 bg-danger text-surface rounded-xl md:rounded-2xl font-bold text-xs md:text-sm hover:bg-danger transition-colors"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
