import { useMemo } from 'react';
import { getCategoryColor, getCategoryDetailColor } from '../constants';
import { buildCanonicalTradeRows, buildPositionFromTradeRows } from '../utils/tradeReconciliation';

const parseMetricNumber = (value) => parseFloat(String(value || '').replace(/,/g, '')) || 0;

const getDividendCategoryOrder = (category = '') => {
  if (category?.includes('국내') && category?.includes('주식')) return 10;
  if (category?.includes('해외') && category?.includes('주식')) return 20;
  if (category?.includes('원자재')) return 30;
  if (category?.includes('현금')) return 50;
  return 90;
};

const getPerformanceCategoryOrder = (category = '') => {
  const normalizedCategory = String(category || '').trim();
  if (normalizedCategory.includes('국내') && normalizedCategory.includes('주식')) return 10;
  if (normalizedCategory.includes('해외') && normalizedCategory.includes('주식')) return 20;
  if (normalizedCategory.includes('원자재')) return 30;
  if (normalizedCategory.includes('현금')) return 50;
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

      const purchaseKRW = purchaseNative * krwRate;
      const currentKRW = currentNative * krwRate;
      const profitNative = currentNative - purchaseNative;
      const profitKRW = profitNative * krwRate;

      const returnPercent = (purchaseNative > 0 && a.category !== '현금') ? ((currentNative - purchaseNative) / purchaseNative) * 100 : 0;

      return {
        ...a,
        nativeAveragePrice: safeOrigAvgPrice,
        nativeCurrentPrice: safeOrigCurrPrice,
        purchaseNative,
        currentNative,
        purchaseKRW,
        currentKRW,
        profitNative,
        profitKRW,
        returnPercent,
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
  }, [assets, exchangeRate, jpyKrwRate, currencyRates]);

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
    buildCanonicalTradeRows({ tradeLedger, trades })
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
    acc + ((Number(t.pnl) || 0) * getRecordKrwRate(t, realizedKrwRate))
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
    const names = [...new Set([
      ...enhancedAssets.map(asset => asset.name),
      ...ledgerRows.map(record => record.name),
      ...autoDividends.map(dividend => dividend.name),
    ].filter(Boolean))];

    return names.map((name) => {
      const assetRows = enhancedAssets.filter(asset => asset.name === name);
      const tradeRows = ledgerRows.filter(record => record.name === name);
      const position = buildPositionFromTradeRows(tradeRows);
      const sellRows = position.rows.filter(record => record.side === 'sell');
      const buyRows = position.rows.filter(record => record.side === 'buy');
      const dividendRows = autoDividends.filter(dividend => dividend.name === name);
      const firstAsset = assetRows[0];
      const firstTrade = tradeRows[0];
      const firstDividend = dividendRows[0];
      const currency = firstAsset?.currency || firstTrade?.currency || firstDividend?.currency || 'KRW';

      const unrealizedKRW = assetRows.reduce((sum, asset) => sum + asset.profitKRW, 0);
      const realizedKRW = sellRows.reduce((sum, trade) => sum + ((Number(trade.pnl) || 0) * getRecordKrwRate(trade, getRecordRate)), 0);
      const dividendKRW = dividendRows.reduce((sum, dividend) => sum + (dividend.amount * getRecordKrwRate(dividend, getRecordRate)), 0);
      const totalKRW = unrealizedKRW + realizedKRW + dividendKRW;

      const unrealizedNative = assetRows.reduce((sum, asset) => sum + asset.profitNative, 0);
      const realizedNative = sellRows
        .filter(trade => trade.currency === currency)
        .reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
      const dividendNative = dividendRows
        .filter(dividend => dividend.currency === currency)
        .reduce((sum, dividend) => sum + dividend.amount, 0);

      return {
        name,
        ticker: firstAsset?.ticker || firstTrade?.ticker || '',
        category: firstAsset?.category || firstTrade?.category || '',
        currency,
        quantity: position.hasBuyRows
          ? position.quantity
          : assetRows.reduce((sum, asset) => sum + parseMetricNumber(asset.quantity), 0),
        totalBuyQuantity: buyRows.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0),
        totalSellQuantity: sellRows.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0),
        totalBuyAmountKRW: buyRows.reduce((sum, record) => sum + ((Number(record.price) || 0) * (Number(record.quantity) || 0) * getRecordKrwRate(record, getRecordRate)), 0),
        totalSellAmountKRW: sellRows.reduce((sum, record) => sum + ((Number(record.price) || 0) * (Number(record.quantity) || 0) * getRecordKrwRate(record, getRecordRate)), 0),
        unrealizedKRW,
        realizedKRW,
        dividendKRW,
        totalKRW,
        totalNative: currency === 'KRW' ? totalKRW : unrealizedNative + realizedNative + dividendNative,
      };
    }).sort((a, b) => {
      const categoryDelta = getPerformanceCategoryOrder(a.category) - getPerformanceCategoryOrder(b.category);
      if (categoryDelta !== 0) return categoryDelta;
      return Math.abs(b.totalKRW) - Math.abs(a.totalKRW);
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
          status: '지급 기록 대기',
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
        status = '이번 달 지급 완료';
      } else if (nextMonth === currentMonth && nextYear === currentYear) {
        status = '이번 달 지급 예정';
      } else {
        status = `${nextMonth}월 지급 예정`;
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
