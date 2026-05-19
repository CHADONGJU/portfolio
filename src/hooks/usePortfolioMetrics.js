import { useMemo } from 'react';

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
  exchangeRate,
  selectedCategory,
  selectedDividendAsset,
  dividendFilter,
}) => {
  // 3. 통합 가치 및 차트 계산
  const enhancedAssets = useMemo(() => {
    return assets.map(a => {
      // originalAveragePrice가 무조건 있어야 수학이 맞음
      const safeOrigAvgPrice = a.originalAveragePrice || a.averagePrice;
      const safeOrigCurrPrice = a.originalCurrentPrice || a.currentPrice;

      const purchaseNative = safeOrigAvgPrice * a.quantity;
      const currentNative = safeOrigCurrPrice * a.quantity;
      
      const purchaseKRW = a.currency === 'USD' ? purchaseNative * (a.buyExchangeRate || exchangeRate || 1350) : purchaseNative;
      const currentKRW = a.currency === 'USD' ? currentNative * (exchangeRate || 1350) : currentNative; 
      const profitNative = currentNative - purchaseNative;
      const profitKRW = currentKRW - purchaseKRW;
      
      const returnPercent = (purchaseNative > 0 && a.category !== '현금') ? ((currentNative - purchaseNative) / purchaseNative) * 100 : 0;
      
      return { ...a, purchaseNative, currentNative, purchaseKRW, currentKRW, profitNative, profitKRW, returnPercent };
    });
  }, [assets, exchangeRate]);

  const totalConvertedKRW = useMemo(() => enhancedAssets.reduce((acc, a) => acc + a.currentKRW, 0), [enhancedAssets]);
  
  const categoryData = useMemo(() => {
    const grouped = enhancedAssets.reduce((acc, asset) => {
      if (!acc[asset.category]) acc[asset.category] = { id: asset.category, name: asset.category, value: 0, color: asset.color };
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
  const { totalUsdPurchase, totalKrwPurchaseForUsd, currentKrwValueForUsd } = useMemo(() => {
    const usdAssets = enhancedAssets.filter(a => a.currency === 'USD');
    return { 
      totalUsdPurchase: usdAssets.reduce((acc, a) => acc + a.purchaseNative, 0), 
      totalKrwPurchaseForUsd: usdAssets.reduce((acc, a) => acc + a.purchaseKRW, 0), 
      currentKrwValueForUsd: usdAssets.reduce((acc, a) => acc + a.currentKRW, 0) 
    };
  }, [enhancedAssets]);
  const avgBuyExchangeRate = totalUsdPurchase > 0 ? (totalKrwPurchaseForUsd / totalUsdPurchase) : 0;
  const fxProfitPercent = totalKrwPurchaseForUsd > 0 ? ((currentKrwValueForUsd - totalKrwPurchaseForUsd) / totalKrwPurchaseForUsd) * 100 : 0;

  const sellLedger = tradeLedger.filter(entry => entry.side === 'sell');
  const realizedRecords = sellLedger.length > 0 ? sellLedger : trades;
  const krwTrades = realizedRecords.filter(t => t.currency === 'KRW');
  const usdTrades = realizedRecords.filter(t => t.currency === 'USD');
  const krwNetProfit = krwTrades.reduce((acc, t) => acc + t.pnl, 0);
  const usdNetProfit = usdTrades.reduce((acc, t) => acc + t.pnl, 0);
  const totalConvertedNetProfit = krwNetProfit + (usdNetProfit * (exchangeRate || 1350));

  const stockPerformanceSummary = useMemo(() => {
    const rate = exchangeRate || 1350;
    const ledgerRows = tradeLedger.length > 0 ? tradeLedger : trades.map(trade => ({
      ...trade,
      side: 'sell',
      price: trade.sellPrice,
      date: trade.sellDate,
    }));
    const names = [...new Set([
      ...enhancedAssets.map(asset => asset.name),
      ...ledgerRows.map(record => record.name),
      ...autoDividends.map(dividend => dividend.name),
    ].filter(Boolean))];

    return names.map((name) => {
      const assetRows = enhancedAssets.filter(asset => asset.name === name);
      const tradeRows = ledgerRows.filter(record => record.name === name);
      const sellRows = tradeRows.filter(record => record.side === 'sell');
      const buyRows = tradeRows.filter(record => record.side === 'buy');
      const dividendRows = autoDividends.filter(dividend => dividend.name === name);
      const firstAsset = assetRows[0];
      const firstTrade = tradeRows[0];
      const firstDividend = dividendRows[0];
      const currency = firstAsset?.currency || firstTrade?.currency || firstDividend?.currency || 'KRW';

      const unrealizedKRW = assetRows.reduce((sum, asset) => sum + asset.profitKRW, 0);
      const realizedKRW = sellRows.reduce((sum, trade) => sum + (trade.currency === 'USD' ? trade.pnl * rate : trade.pnl), 0);
      const dividendKRW = dividendRows.reduce((sum, dividend) => sum + (dividend.currency === 'USD' ? dividend.amount * rate : dividend.amount), 0);
      const totalKRW = unrealizedKRW + realizedKRW + dividendKRW;

      const unrealizedNative = assetRows.reduce((sum, asset) => sum + asset.profitNative, 0);
      const realizedNative = sellRows
        .filter(trade => trade.currency === currency)
        .reduce((sum, trade) => sum + trade.pnl, 0);
      const dividendNative = dividendRows
        .filter(dividend => dividend.currency === currency)
        .reduce((sum, dividend) => sum + dividend.amount, 0);

      return {
        name,
        ticker: firstAsset?.ticker || firstTrade?.ticker || '',
        category: firstAsset?.category || firstTrade?.category || '',
        currency,
        quantity: assetRows.reduce((sum, asset) => sum + (Number(asset.quantity) || 0), 0),
        totalBuyQuantity: buyRows.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0),
        totalSellQuantity: sellRows.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0),
        totalBuyAmountKRW: buyRows.reduce((sum, record) => sum + ((Number(record.price) || 0) * (Number(record.quantity) || 0) * (record.currency === 'USD' ? rate : 1)), 0),
        totalSellAmountKRW: sellRows.reduce((sum, record) => sum + ((Number(record.price) || 0) * (Number(record.quantity) || 0) * (record.currency === 'USD' ? rate : 1)), 0),
        unrealizedKRW,
        realizedKRW,
        dividendKRW,
        totalKRW,
        totalNative: currency === 'USD' ? unrealizedNative + realizedNative + dividendNative : totalKRW,
      };
    }).sort((a, b) => Math.abs(b.totalKRW) - Math.abs(a.totalKRW));
  }, [enhancedAssets, tradeLedger, trades, autoDividends, exchangeRate]);

  // 5. 배당금 그룹화
  const dividendSummary = useMemo(() => {
    const summary = {};
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    assets.forEach(asset => {
      const assetDivs = autoDividends.filter(d => d.name === asset.name);
      if (assetDivs.length === 0) return;

      const totalAmount = assetDivs.reduce((sum, d) => sum + d.amount, 0);
      let status = '';
      let expectedAmount = 0;

      const lastDiv = assetDivs[0];
      const lastDate = new Date(lastDiv.date);
      expectedAmount = lastDiv.amount;

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
        name: asset.name, currency: lastDiv.currency, totalAmount, status, expectedAmount, history: assetDivs
      };
    });
    
    return Object.values(summary).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [autoDividends, assets]);

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
    currentCategoryKRW,
    currentCategoryUSD,
    currentCategoryTotalConverted,
    currentCategoryProfitKRW,
    currentCategoryProfitUSD,
    totalUsdPurchase,
    avgBuyExchangeRate,
    fxProfitPercent,
    currentKrwValueForUsd,
    krwNetProfit,
    usdNetProfit,
    totalConvertedNetProfit,
    stockPerformanceSummary,
    dividendSummary,
    filteredHistory,
  };
};
