import { useMemo } from 'react';
import { getCategoryColor, getCategoryDetailColor } from '../constants';
import {
  buildCanonicalTradeRows,
  buildKrwCostBasisByAsset,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  getTradeRound,
} from '../utils/tradeReconciliation';

const parseMetricNumber = (value) => parseFloat(String(value || '').replace(/,/g, '')) || 0;

const getDividendCategoryOrder = (category = '') => {
  if (category?.includes('국내') && category?.includes('주식')) return 10;
  if (category?.includes('해외') && category?.includes('주식')) return 20;
  if (category?.includes('원자재')) return 30;
  if (category?.includes('현금')) return 50;
  return 90;
};

/**
 * currentPrice는 원화 환산값이고 originalCurrentPrice가 현지 통화 가격이다.
 * 구 데이터에는 originalCurrentPrice가 없을 수 있는데, 그때 currentPrice를
 * 현지 통화로 착각하면 환율이 두 번 곱해진다. 여기서 역산해 통일한다.
 */
export const toNativePrice = (nativeValue, krwValue, krwRate) => {
  const native = parseMetricNumber(nativeValue);
  if (native > 0) return native;

  const krw = parseMetricNumber(krwValue);
  if (krw > 0 && krwRate > 0) return krw / krwRate;

  return 0;
};

/**
 * 실현손익/배당은 "지금 환율"이 아니라 그 거래가 일어난 시점의 환율로 환산해야
 * 과거 누적 실현손익이 매일 흔들리지 않는다. 기록에 fxRate가 있으면 그것을 쓴다.
 */
const getRecordKrwRate = (record = {}, rateByCurrency) => {
  const storedRate = Number(record.fxRate);
  if (Number.isFinite(storedRate) && storedRate > 0) return storedRate;
  return rateByCurrency(record.currency);
};

/**
 * 매도 한 건의 원화 실현손익.
 * 매수일·매도일 환율을 모두 아는 기록은 krwPnl(환차손익 포함)을 그대로 쓰고,
 * 환율을 다 모르는 옛 기록만 "손익 × 매도일 환율"로 근사한다.
 */
const getRecordKrwPnl = (record = {}, rateByCurrency) => {
  const exactKrwPnl = Number(record.krwPnl);
  if (record.krwPnl !== null && record.krwPnl !== undefined && Number.isFinite(exactKrwPnl)) {
    return exactKrwPnl;
  }
  return (Number(record.pnl) || 0) * getRecordKrwRate(record, rateByCurrency);
};

const withRunningPercent = (items, total, getValue) => {
  let cumulativePercent = 0;

  return items.map((item) => {
    const percent = total > 0 ? (getValue(item) / total) * 100 : 0;
    const startPercent = cumulativePercent;
    cumulativePercent += percent;

    return { ...item, percent, startPercent };
  });
};

export const usePortfolioMetrics = ({
  assets,
  trades,
  tradeLedger = [],
  autoDividends,
  dividendAssetRegistry = [],
  exchangeRate,
  jpyKrwRate,
  currencyRates = {},
  selectedCategory,
  selectedDividendAsset,
  dividendFilter,
}) => {
  // 3. 통합 가치 및 차트 계산
  const enhancedAssets = useMemo(() => {
    const toKrwRate = (currency) => {
      if (currency === 'USD') return exchangeRate || 1350;
      if (currency === 'JPY') return jpyKrwRate || 9.5;
      if (currency && currency !== 'KRW') return currencyRates[currency] || 1;
      return 1;
    };

    // 매수 기록에 남은 "그날의 환율"로 원가를 쌓는다.
    // 환율이 없는 원화 거래는 1, 외화인데 환율을 아직 못 채운 기록은 0을 돌려
    // 원금을 정확하다고 표시하지 않게 한다.
    const resolveRecordKrwRate = (record = {}) => {
      const currency = record.currency || 'KRW';
      if (!currency || currency === 'KRW') return 1;
      const storedRate = Number(record.fxRate);
      return Number.isFinite(storedRate) && storedRate > 0 ? storedRate : 0;
    };
    const krwCostBasisByAsset = buildKrwCostBasisByAsset(tradeLedger, resolveRecordKrwRate);

    const calculatedAssets = assets.map((a) => {
      const krwRate = toKrwRate(a.currency);
      // quantity가 "1,000" 같은 문자열로 들어오면 곱셈이 통째로 NaN이 되고,
      // 화면에는 NaN 대신 0으로 위장되어 표시된다. 반드시 파싱한다.
      const quantity = parseMetricNumber(a.quantity);

      // averagePrice는 항상 현지 통화지만, currentPrice는 원화 환산값이다.
      const safeOrigAvgPrice = parseMetricNumber(a.originalAveragePrice) || parseMetricNumber(a.averagePrice);
      const safeOrigCurrPrice = toNativePrice(a.originalCurrentPrice, a.currentPrice, krwRate);

      const purchaseNative = safeOrigAvgPrice * quantity;
      const currentNative = safeOrigCurrPrice * quantity;

      /**
       * 투자 원금(원화)은 세 단계로 정한다.
       * 1) 사용자가 증권사 숫자를 직접 넣었으면 그 값을 그대로 믿는다.
       * 2) 매수 기록의 시점 환율로 쌓은 실제 투입 원화.
       * 3) 둘 다 없으면 어쩔 수 없이 오늘 환율로 환산한다.
       */
      const manualPurchaseKRW = parseMetricNumber(a.manualPurchaseKRW);
      const costBasis = krwCostBasisByAsset.get(getTradeAssetKey(a));
      const hasLedgerCost = Boolean(costBasis?.hasExactKrwCost) && costBasis.krwCost > 0;

      let purchaseKRW = purchaseNative * krwRate;
      let purchaseKRWSource = 'today-rate';
      if (manualPurchaseKRW > 0) {
        purchaseKRW = manualPurchaseKRW;
        purchaseKRWSource = 'manual';
      } else if (hasLedgerCost) {
        purchaseKRW = costBasis.krwCost;
        purchaseKRWSource = 'trade-date-rate';
      }

      /**
       * 원화 표시에 쓰는 환율은 "오늘 환율"이 아니라 "이 종목을 살 때 쓴 환율"로 고정한다.
       *
       * 오늘 환율로 평가금액을 환산하면, 주가가 하나도 안 움직인 날에도 총 보유자산이
       * 환율만큼 오르내린다. 환율 변동을 손익으로 보고 싶지 않다는 요구에 맞춰
       * 매입도 평가도 같은 환율을 쓰게 해 환차손익이 아예 생기지 않게 한다.
       * 원금을 아직 확정하지 못한 자산만 어쩔 수 없이 오늘 환율을 쓴다.
       */
      const displayKrwRate = purchaseNative > 0 && purchaseKRW > 0
        ? purchaseKRW / purchaseNative
        : krwRate;
      const currentKRW = currentNative * displayKrwRate;

      const profitNative = currentNative - purchaseNative;
      // 매입·평가에 같은 환율을 쓰므로 원화 손익은 주가 손익을 환산한 값과 정확히 같다.
      const profitKRW = currentKRW - purchaseKRW;

      const returnPercent = (purchaseNative > 0 && a.category !== '현금') ? ((currentNative - purchaseNative) / purchaseNative) * 100 : 0;
      const returnPercentKRW = (purchaseKRW > 0 && a.category !== '현금') ? (profitKRW / purchaseKRW) * 100 : 0;
      // 원화 기준 평단가 = 실제 투입 원화 ÷ 보유 수량.
      const krwAveragePrice = quantity > 0 ? purchaseKRW / quantity : 0;

      return {
        ...a,
        // 종목 행마다 달러/원화를 바꿔 볼 수 있도록 적용 환율을 그대로 실어 보낸다.
        krwRate: displayKrwRate,
        todayKrwRate: krwRate,
        round: getTradeRound(a),
        nativeAveragePrice: safeOrigAvgPrice,
        nativeCurrentPrice: safeOrigCurrPrice,
        krwAveragePrice,
        purchaseNative,
        currentNative,
        purchaseKRW,
        purchaseKRWSource,
        currentKRW,
        profitNative,
        profitKRW,
        returnPercent,
        returnPercentKRW,
      };
    });

    const rankByCategory = calculatedAssets.reduce((acc, asset) => {
      if (!acc[asset.category]) acc[asset.category] = [];
      acc[asset.category].push(asset);
      return acc;
    }, {});

    Object.values(rankByCategory).forEach((categoryAssets) => {
      categoryAssets
        .sort((a, b) => b.currentKRW - a.currentKRW)
        .forEach((asset, index) => {
          asset.color = getCategoryDetailColor(asset.category, index);
        });
    });

    return calculatedAssets;
  }, [assets, tradeLedger, exchangeRate, jpyKrwRate, currencyRates]);

  const totalConvertedKRW = useMemo(() => enhancedAssets.reduce((acc, a) => acc + a.currentKRW, 0), [enhancedAssets]);
  
  const categoryData = useMemo(() => {
    const grouped = enhancedAssets.reduce((acc, asset) => {
      if (!acc[asset.category]) acc[asset.category] = { id: asset.category, name: asset.category, value: 0, color: getCategoryColor(asset.category) };
      acc[asset.category].value += asset.currentKRW;
      return acc;
    }, {});
    return withRunningPercent(
      Object.values(grouped).sort((a, b) => b.value - a.value),
      totalConvertedKRW,
      (cat) => cat.value,
    );
  }, [enhancedAssets, totalConvertedKRW]);

  const subChartData = useMemo(() => {
    if (!selectedCategory) return [];
    const filtered = enhancedAssets.filter(a => a.category === selectedCategory);
    const subTotalKRW = filtered.reduce((acc, curr) => acc + curr.currentKRW, 0);
    return withRunningPercent(
      filtered.sort((a, b) => b.currentKRW - a.currentKRW),
      subTotalKRW,
      (asset) => asset.currentKRW,
    ).map((asset) => ({ ...asset, subTotal: subTotalKRW }));
  }, [enhancedAssets, selectedCategory]);

  const currentChartData = selectedCategory ? subChartData : categoryData;
  const currentCategoryKRW = selectedCategory ? enhancedAssets.filter(a => a.category === selectedCategory && a.currency === 'KRW').reduce((acc, a) => acc + a.currentNative, 0) : enhancedAssets.filter(a => a.currency === 'KRW').reduce((acc, a) => acc + a.currentNative, 0);
  const currentCategoryUSD = selectedCategory ? enhancedAssets.filter(a => a.category === selectedCategory && a.currency === 'USD').reduce((acc, a) => acc + a.currentNative, 0) : enhancedAssets.filter(a => a.currency === 'USD').reduce((acc, a) => acc + a.currentNative, 0);
  const currentCategoryTotalConverted = selectedCategory && subChartData.length > 0 ? subChartData[0].subTotal : totalConvertedKRW;
  const currentCategoryProfitKRW = selectedCategory
    ? enhancedAssets.filter(a => a.category === selectedCategory).reduce((acc, a) => acc + a.profitKRW, 0)
    : enhancedAssets.reduce((acc, a) => acc + a.profitKRW, 0);
  const currentCategoryProfitUSD = selectedCategory
    ? enhancedAssets.filter(a => a.category === selectedCategory && a.currency === 'USD').reduce((acc, a) => acc + a.profitNative, 0)
    : enhancedAssets.filter(a => a.currency === 'USD').reduce((acc, a) => acc + a.profitNative, 0);

  // 4. 환차익 & 매매 기록 계산
  const { totalUsdPurchase, currentUsdValueForUsd } = useMemo(() => {
    const usdAssets = enhancedAssets.filter(a => a.currency === 'USD');
    return { 
      totalUsdPurchase: usdAssets.reduce((acc, a) => acc + a.purchaseNative, 0), 
      currentUsdValueForUsd: usdAssets.reduce((acc, a) => acc + a.currentNative, 0) 
    };
  }, [enhancedAssets]);
  const avgBuyExchangeRate = 0;
  const fxProfitPercent = totalUsdPurchase > 0 ? ((currentUsdValueForUsd - totalUsdPurchase) / totalUsdPurchase) * 100 : 0;

  const canonicalTradeRows = useMemo(() => (
    // 매수·매도 시점 환율을 함께 넘겨야 원화 실현손익에 환차손익이 제대로 들어간다.
    buildCanonicalTradeRows({
      tradeLedger,
      trades,
      resolveKrwRate: (record) => {
        const currency = record?.currency || 'KRW';
        if (currency === 'KRW') return 1;
        const storedRate = Number(record?.fxRate);
        return Number.isFinite(storedRate) && storedRate > 0 ? storedRate : 0;
      },
    })
  ), [tradeLedger, trades]);
  const realizedRecords = canonicalTradeRows.filter(record => record.side === 'sell');
  const realizedKrwRate = (currency) => {
    if (currency === 'USD') return exchangeRate || 1350;
    if (currency === 'JPY') return jpyKrwRate || 9.5;
    if (currency && currency !== 'KRW') return currencyRates[currency] || 1;
    return 1;
  };
  const krwTrades = realizedRecords.filter(t => t.currency === 'KRW');
  const usdTrades = realizedRecords.filter(t => t.currency === 'USD');
  const krwNetProfit = krwTrades.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0);
  const usdNetProfit = usdTrades.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0);
  const totalConvertedNetProfit = realizedRecords.reduce((acc, t) => (
    acc + getRecordKrwPnl(t, realizedKrwRate)
  ), 0);

  const stockPerformanceSummary = useMemo(() => {
    const rate = exchangeRate || 1350;
    const jpyRate = jpyKrwRate || 9.5;
    const getRecordRate = (currency) => {
      if (currency === 'USD') return rate;
      if (currency === 'JPY') return jpyRate;
      if (currency && currency !== 'KRW') return currencyRates[currency] || 1;
      return 1;
    };
    const ledgerRows = canonicalTradeRows;

    // 종목명만이 아니라 "종목명 + 보유 회차"로 묶는다.
    // 매도 후 재매수한 종목은 회차가 다르므로 평가/실현 손익이 서로 섞이지 않는다.
    const groupKey = (record) => `${record.name}#${getTradeRound(record)}`;
    const groups = new Map();
    [...enhancedAssets, ...ledgerRows, ...autoDividends].forEach((record) => {
      if (!record?.name) return;
      const key = groupKey(record);
      if (!groups.has(key)) groups.set(key, { name: record.name, round: getTradeRound(record) });
    });

    // 회차 정보가 없는 과거 배당 기록은 그 종목의 마지막 회차에만 붙여 중복 합산을 막는다.
    const latestRoundByName = new Map();
    groups.forEach(({ name, round }) => {
      latestRoundByName.set(name, Math.max(latestRoundByName.get(name) ?? 1, round));
    });

    return [...groups.values()].map(({ name, round }) => {
      const inGroup = (record) => record.name === name && getTradeRound(record) === round;
      const assetRows = enhancedAssets.filter(inGroup);
      const tradeRows = ledgerRows.filter(inGroup);
      const position = buildPositionFromTradeRows(tradeRows);
      const sellRows = position.rows.filter(record => record.side === 'sell');
      const buyRows = position.rows.filter(record => record.side === 'buy');
      const dividendRows = autoDividends.filter((dividend) => {
        if (dividend.name !== name) return false;
        if (dividend.round !== undefined && dividend.round !== null) return getTradeRound(dividend) === round;
        return latestRoundByName.get(name) === round;
      });
      const firstAsset = assetRows[0];
      const firstTrade = tradeRows[0];
      const firstDividend = dividendRows[0];
      const currency = firstAsset?.currency || firstTrade?.currency || firstDividend?.currency || 'KRW';

      const unrealizedKRW = assetRows.reduce((sum, asset) => sum + asset.profitKRW, 0);
      const realizedKRW = sellRows.reduce((sum, trade) => sum + getRecordKrwPnl(trade, getRecordRate), 0);
      const dividendKRW = dividendRows.reduce((sum, dividend) => sum + (dividend.amount * getRecordKrwRate(dividend, getRecordRate)), 0);
      const totalKRW = unrealizedKRW + realizedKRW + dividendKRW;

      const unrealizedNative = assetRows.reduce((sum, asset) => sum + asset.profitNative, 0);
      const realizedNative = sellRows
        .filter(trade => trade.currency === currency)
        .reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
      const dividendNative = dividendRows
        .filter(dividend => dividend.currency === currency)
        .reduce((sum, dividend) => sum + dividend.amount, 0);

      const totalSellQuantity = sellRows.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0);
      const heldQuantity = position.hasBuyRows
        ? position.quantity
        : assetRows.reduce((sum, asset) => sum + parseMetricNumber(asset.quantity), 0);
      // 전량 매도해 이미 정리된 포지션. 손익이 실현손익뿐이므로 매수일이 아니라 매도일이 기준이다.
      const isClosedPosition = heldQuantity <= 0 && totalSellQuantity > 0;
      const firstBuyDate = position.firstBuyDate || firstAsset?.buyDate || '';
      const lastSellDate = sellRows
        .map(record => record.date)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || '';

      return {
        name,
        round,
        key: `${name}#${round}`,
        // 같은 종목을 팔았다 다시 산 경우 이름만으로는 두 줄이 구분되지 않는다.
        // 회차 번호를 붙이는 대신 날짜로 갈라 보여준다.
        firstBuyDate,
        lastSellDate,
        isClosedPosition,
        displayDate: isClosedPosition ? (lastSellDate || firstBuyDate) : firstBuyDate,
        displayDateLabel: isClosedPosition ? '매도' : '매수',
        ticker: firstAsset?.ticker || firstTrade?.ticker || '',
        category: firstAsset?.category || firstTrade?.category || '',
        currency,
        quantity: heldQuantity,
        totalBuyQuantity: buyRows.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0),
        totalSellQuantity,
        totalBuyAmountKRW: buyRows.reduce((sum, record) => sum + ((Number(record.price) || 0) * (Number(record.quantity) || 0) * getRecordKrwRate(record, getRecordRate)), 0),
        totalSellAmountKRW: sellRows.reduce((sum, record) => sum + ((Number(record.price) || 0) * (Number(record.quantity) || 0) * getRecordKrwRate(record, getRecordRate)), 0),
        unrealizedKRW,
        realizedKRW,
        dividendKRW,
        totalKRW,
        totalNative: currency === 'KRW' ? totalKRW : unrealizedNative + realizedNative + dividendNative,
      };
    }).sort((a, b) => {
      // 최근 거래가 위로 오도록 날짜 내림차순으로 세운다.
      // 날짜가 없는 기록은 비교할 기준이 없으므로 맨 뒤로 보낸다.
      if (a.displayDate !== b.displayDate) {
        if (!a.displayDate) return 1;
        if (!b.displayDate) return -1;
        return a.displayDate > b.displayDate ? -1 : 1;
      }
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return b.round - a.round;
    });
  }, [enhancedAssets, canonicalTradeRows, autoDividends, exchangeRate, jpyKrwRate, currencyRates]);

  // 5. 배당금 그룹화
  const dividendSummary = useMemo(() => {
    const summary = {};
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    const activeDividendAssets = new Map();

    dividendAssetRegistry.forEach((entry) => {
      if (!entry?.hasDividends || !entry.name) return;
      const asset = assets.find(candidate => candidate.name === entry.name);
      if (!asset) return;
      activeDividendAssets.set(entry.name, { asset, registry: entry });
    });

    assets.forEach(asset => {
      const assetDivs = autoDividends.filter(d => d.name === asset.name);
      if (assetDivs.length > 0) activeDividendAssets.set(asset.name, { asset, registry: null });
    });

    activeDividendAssets.forEach(({ asset, registry }) => {
      const assetDivs = autoDividends.filter(d => d.name === asset.name);
      if (assetDivs.length === 0) {
        summary[asset.name] = {
          name: asset.name,
          ticker: asset.ticker || registry?.ticker || '',
          category: asset.category || registry?.category || '',
          currency: asset.currency || registry?.currency || 'KRW',
          totalAmount: 0,
          status: '배당락 기록 대기',
          expectedAmount: 0,
          history: [],
        };
        return;
      }

      const totalAmount = assetDivs.reduce((sum, d) => sum + d.amount, 0);
      let status = '';
      let expectedAmount = 0;

      const lastDiv = assetDivs[0];
      const lastDate = new Date(lastDiv.date);
      const currentQuantity = parseMetricNumber(asset.quantity);
      const lastDividendQuantity = Number(lastDiv.quantity) || 0;
      const perShareNetAmount = Number(lastDiv.perShareNetAmount)
        || (lastDividendQuantity > 0 ? lastDiv.amount / lastDividendQuantity : 0);
      expectedAmount = perShareNetAmount * currentQuantity;

      let monthDiff = 3; 
      if (assetDivs.length > 1) {
        const prevDate = new Date(assetDivs[1].date);
        const daysDiff = (lastDate - prevDate) / (1000 * 60 * 60 * 24);
        if (daysDiff >= 20 && daysDiff <= 45) monthDiff = 1;
        else if (daysDiff >= 80 && daysDiff <= 110) monthDiff = 3;
        else if (daysDiff >= 150 && daysDiff <= 200) monthDiff = 6;
        else if (daysDiff >= 330) monthDiff = 12;
      }

      const nextDate = new Date(lastDate);
      nextDate.setMonth(nextDate.getMonth() + monthDiff);
      const nextMonth = nextDate.getMonth() + 1;
      const nextYear = nextDate.getFullYear();

      if (lastDate.getMonth() + 1 === currentMonth && lastDate.getFullYear() === currentYear) {
        status = '이번 달 배당 반영';
      } else if (nextMonth === currentMonth && nextYear === currentYear) {
        status = '이번 달 배당락 예상';
      } else {
        status = `${nextMonth}월 배당락 예상`;
      }

      summary[asset.name] = {
        name: asset.name,
        ticker: asset.ticker || registry?.ticker || '',
        category: asset.category || '',
        currency: lastDiv.currency,
        totalAmount,
        status,
        expectedAmount,
        history: assetDivs,
      };
    });
    
    return Object.values(summary).sort((a, b) => {
      const categoryDelta = getDividendCategoryOrder(a.category) - getDividendCategoryOrder(b.category);
      if (categoryDelta !== 0) return categoryDelta;
      return b.totalAmount - a.totalAmount;
    });
  }, [autoDividends, assets, dividendAssetRegistry]);

  const filteredHistory = useMemo(() => {
    if (!selectedDividendAsset) return [];
    const summary = dividendSummary.find(s => s.name === selectedDividendAsset);
    if (!summary) return [];
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    return summary.history.filter(d => {
      const divDate = new Date(d.date);
      if (dividendFilter === '이번 달') return divDate.getFullYear() === currentYear && divDate.getMonth() === currentMonth;
      if (dividendFilter === '올해') return divDate.getFullYear() === currentYear;
      return true;
    });
  }, [dividendSummary, selectedDividendAsset, dividendFilter]);

  // 자산 및 기록 삭제 로직 강화 
  return {
    enhancedAssets,
    totalConvertedKRW,
    currentChartData,
    subChartData,
    currentCategoryKRW,
    currentCategoryUSD,
    currentCategoryTotalConverted,
    currentCategoryProfitKRW,
    currentCategoryProfitUSD,
    totalUsdPurchase,
    avgBuyExchangeRate,
    fxProfitPercent,
    currentUsdValueForUsd,
    krwNetProfit,
    usdNetProfit,
    totalConvertedNetProfit,
    stockPerformanceSummary,
    dividendSummary,
    filteredHistory,
  };
};
