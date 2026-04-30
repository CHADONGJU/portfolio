import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Plus, Minus, TrendingUp, TrendingDown, Trash2,
  PieChart as PieIcon,
  Receipt, Wallet, ArrowLeft, X, Banknote, DollarSign, Globe, ArrowRightLeft, Search
} from 'lucide-react';
import DashboardHeader from './components/DashboardHeader';
import MemoTab from './components/MemoTab';
import SyncStatusToast from './components/SyncStatusToast';
import TabNav from './components/TabNav';
import { ASSET_COLORS, ASSETS_STORAGE_KEY, MEMOS_STORAGE_KEY, TRADES_STORAGE_KEY } from './constants';
import { fetchBitcoinPrices, fetchDividends, fetchStockPrice, fetchUsdKrwRate } from './services/marketData';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from './utils/formatters';
import { loadJson, saveJson } from './utils/storage';
import { usePortfolioMetrics } from './hooks/usePortfolioMetrics';

const isDomesticStockCategory = (category) => category?.includes('국내') && category?.includes('주식');
const isCommodityCategory = (category) => category?.includes('원자재');

const TRADE_SORT_OPTIONS = [
  { value: 'newest', label: '최신 날짜 우선' },
  { value: 'oldest', label: '가장 오래된 날짜 우선' },
  { value: 'profit-desc', label: '실현 손익(이득 큰 순)' },
  { value: 'profit-asc', label: '실현 손익(손해 큰 순)' },
];

const parseNumber = (value) => parseFloat(String(value || '').replace(/,/g, '')) || 0;
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

const sortTradeRecords = (records, sortMode) => [...records].sort((a, b) => {
  if (sortMode === 'oldest') return new Date(getRecordDate(a)) - new Date(getRecordDate(b));
  if (sortMode === 'profit-desc') return getRecordPnl(b) - getRecordPnl(a);
  if (sortMode === 'profit-asc') return getRecordPnl(a) - getRecordPnl(b);
  return new Date(getRecordDate(b)) - new Date(getRecordDate(a));
});

const buildTradeSummary = (records, exchangeRate = 1) => records.reduce((summary, record) => {
  const quantity = Number(record.quantity) || 0;
  const action = normalizeTradeAction(record);
  const pnl = getRecordPnl(record);
  const pnlKRW = record.currency === 'USD' ? pnl * exchangeRate : pnl;

  if (action === '매수') summary.totalBuyQuantity += quantity;
  if (action === '매도') summary.totalSellQuantity += quantity;
  summary.totalProfit += pnlKRW;

  return summary;
}, {
  totalBuyQuantity: 0,
  totalSellQuantity: 0,
  totalProfit: 0,
});

const App = () => {
  // 1. 상태 관리
  const [exchangeRate, setExchangeRate] = useState(0); 
  const [isLiveMode] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState('portfolio');
  const [isFetching, setIsFetching] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 피드백 로그 (3초 뒤 자동 삭제)
  const [syncStatus, setSyncStatus] = useState([]);
  const addLog = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setSyncStatus(prev => [{ id, msg, type }, ...prev].slice(0, 4));
    setTimeout(() => {
      setSyncStatus(prev => prev.filter(log => log.id !== id));
    }, 3000);
  };

  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedDividendAsset, setSelectedDividendAsset] = useState(null);
  const [dividendFilter, setDividendFilter] = useState('전체');

  const [isAdding, setIsAdding] = useState(false);
  const defaultBuyDate = new Date().toISOString().split('T')[0];
  const [tradeSortMode, setTradeSortMode] = useState('newest');
  const [tradeStockFilter, setTradeStockFilter] = useState('all');
  const [memoSortMode, setMemoSortMode] = useState('newest');
  const [memoStockFilter, setMemoStockFilter] = useState('all');
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
  buyExchangeRate: '',
  memo: ''
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

const initialSellFormState = {
  sellPrice: '',
  quantity: '',
  sellDate: defaultBuyDate,
  memo: ''
};

const [sellForm, setSellForm] = useState(initialSellFormState);

  useEffect(() => {
    if (newAsset.category === '해외주식' || newAsset.category === '원자재') {
      setNewAsset(prev => ({ ...prev, currency: 'USD', buyExchangeRate: exchangeRate === 0 ? '' : exchangeRate }));
    } else if (newAsset.category === '현금') {
      setNewAsset(prev => ({ ...prev, averagePrice: 1, ticker: '' }));
    } else {
      setNewAsset(prev => ({ ...prev, currency: 'KRW', buyExchangeRate: 1 }));
    }
  }, [newAsset.category, exchangeRate]);

  const [assets, setAssets] = useState(() => {
    return loadJson(ASSETS_STORAGE_KEY, []);
  });

  const [trades, setTrades] = useState(() => {
    return loadJson(TRADES_STORAGE_KEY, []);
  });

  const [memos, setMemos] = useState(() => {
    return loadJson(MEMOS_STORAGE_KEY, []);
  });

  const [autoDividends, setAutoDividends] = useState([]);

  useEffect(() => { saveJson(ASSETS_STORAGE_KEY, assets); }, [assets]);
  useEffect(() => { saveJson(TRADES_STORAGE_KEY, trades); }, [trades]);
  useEffect(() => { saveJson(MEMOS_STORAGE_KEY, memos); }, [memos]);

  // 2. 완벽한 데이터 연동 로직
  const assetsRef = useRef(assets);
  const exchangeRateRef = useRef(exchangeRate);
  const initialFetchDoneRef = useRef(false);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => { exchangeRateRef.current = exchangeRate; }, [exchangeRate]);
  

  useEffect(() => {
    if (refreshTrigger === 0 && initialFetchDoneRef.current) return;
    if (refreshTrigger === 0) initialFetchDoneRef.current = true;
    const fetchLiveData = async () => {
      setIsFetching(true);
      addLog("데이터 연동을 시작합니다...", "info");

      try {
        let currentRate = exchangeRateRef.current;
        
        // [1] 환율 연동
        const fetchedRate = await fetchUsdKrwRate();
        if (fetchedRate) {
          currentRate = fetchedRate;
          addLog(`환율 연동 완료: 1$ = ${currentRate.toLocaleString(undefined, {maximumFractionDigits:2})}원`, "success");
        } else {
          addLog("환율 서버 응답 지연", "error");
        }
        if (currentRate > 0) setExchangeRate(currentRate);

        // 코인 연동 (선택적)
        const bitcoinPrices = await fetchBitcoinPrices();

        const currentAssets = assetsRef.current;
        let newAutoDividends = [];
        let successCount = 0;
        let failCount = 0;

        const updatedAssets = await Promise.all(currentAssets.map(async (asset) => {
          let newCurrentPrice = asset.currentPrice;
          let newOriginalCurrentPrice = asset.originalCurrentPrice || asset.originalAveragePrice;
          
          if (asset.category === '현금') {
            newCurrentPrice = 1; newOriginalCurrentPrice = 1;
            successCount++;
          } else if (asset.category === '가상화폐') {
            if (asset.currency === 'KRW' && bitcoinPrices.krw) { newCurrentPrice = bitcoinPrices.krw; successCount++; }
            else if (asset.currency === 'USD' && bitcoinPrices.usd) { newCurrentPrice = bitcoinPrices.usd; successCount++; }
            else failCount++;
          } else if (asset.ticker) {
            
            // 현재가 연동
            const fetchedPrice = await fetchStockPrice(asset);
            
            if (fetchedPrice !== null) {
              if (asset.currency === 'USD') {
                newOriginalCurrentPrice = fetchedPrice; // 달러 현재가
                newCurrentPrice = Math.round(newOriginalCurrentPrice * currentRate); // 원화 현재가
              } else {
                newCurrentPrice = fetchedPrice; // 원화 현재가
                newOriginalCurrentPrice = newCurrentPrice;
              }
              successCount++;
            } else {
              failCount++;
              addLog(`[${asset.name}] 주가 연동 실패 (티커 재확인)`, "error");
            }

            // 배당 갱신 실행 
            if (asset.buyDate && !isCommodityCategory(asset.category)) {
              let yfTicker = asset.ticker.toUpperCase().trim();
              if (isDomesticStockCategory(asset.category) && !yfTicker.includes('.')) yfTicker = `${yfTicker}.KS`;
              
              const divs = await fetchDividends(yfTicker);
              if (divs) {
                const buyTimestamp = new Date(asset.buyDate).getTime() / 1000;
                Object.values(divs).forEach(d => {
                  if (d.date >= buyTimestamp) {
                    newAutoDividends.push({
                      id: `${asset.id}-${d.date}`,
                      date: new Date(d.date * 1000).toISOString().split('T')[0],
                      name: asset.name,
                      amount: d.amount * asset.quantity,
                      currency: asset.originalCurrency || asset.currency
                    });
                  }
                });
              }
            }
          }
          return { ...asset, currentPrice: newCurrentPrice, originalCurrentPrice: newOriginalCurrentPrice };
        }));

        setAssets(updatedAssets);
        newAutoDividends.sort((a, b) => new Date(b.date) - new Date(a.date));
        setAutoDividends(newAutoDividends);
        setLastUpdated(new Date().toLocaleTimeString());

        if (successCount > 0 && failCount === 0) addLog("모든 주식 및 환율 최신화 완료!", "success");
        else if (failCount > 0) addLog(`일부 종목 갱신 실패 (${failCount}건).`, "error");

      } catch (e) { 
        console.error("Update error:", e); 
        addLog("네트워크 오류로 갱신 실패", "error");
      }
      finally { setIsFetching(false); }
    };
    
    fetchLiveData();
    let interval;
    if (isLiveMode) interval = setInterval(fetchLiveData, 300000); 
    return () => { if (interval) clearInterval(interval); };
  }, [isLiveMode, refreshTrigger]);

  const {
    enhancedAssets,
    currentChartData,
    currentCategoryKRW,
    currentCategoryUSD,
    currentCategoryTotalConverted,
    currentCategoryProfitKRW,
    totalUsdPurchase,
    avgBuyExchangeRate,
    fxProfitPercent,
    currentKrwValueForUsd,
    krwNetProfit,
    usdNetProfit,
    totalConvertedNetProfit,
    dividendSummary,
    filteredHistory,
  } = usePortfolioMetrics({
    assets,
    trades,
    autoDividends,
    exchangeRate,
    selectedCategory,
    selectedDividendAsset,
    dividendFilter,
  });

  const isDomesticStockChart = selectedCategory?.includes('국내') && selectedCategory?.includes('주식');
  const profitTone = currentCategoryProfitKRW >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const profitBgTone = currentCategoryProfitKRW >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100';
  const tradeStockOptions = useMemo(() => (
    [...new Set(trades.map((trade) => trade.name).filter(Boolean))].sort()
  ), [trades]);
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
      ...assets.map((asset) => asset.name),
      ...trades.map((trade) => trade.name),
      ...enrichedMemos.map((memo) => memo.name),
    ].filter(Boolean))].sort()
  ), [assets, trades, enrichedMemos]);
  const visibleTrades = useMemo(() => {
    const filtered = tradeStockFilter === 'all'
      ? trades
      : trades.filter((trade) => trade.name === tradeStockFilter);
    return sortTradeRecords(filtered, tradeSortMode);
  }, [trades, tradeStockFilter, tradeSortMode]);
  const visibleMemos = useMemo(() => {
    const filtered = memoStockFilter === 'all'
      ? enrichedMemos
      : enrichedMemos.filter((memo) => memo.name === memoStockFilter);
    return sortTradeRecords(filtered, memoSortMode);
  }, [enrichedMemos, memoStockFilter, memoSortMode]);
  const tradeSummary = useMemo(() => {
    const matchingBuyMemos = enrichedMemos.filter((memo) => (
      getTradeSide(memo) === 'buy'
      && (tradeStockFilter === 'all' || memo.name === tradeStockFilter)
    ));
    const sellSummary = buildTradeSummary(visibleTrades, exchangeRate || 1350);
    const buySummary = buildTradeSummary(matchingBuyMemos, exchangeRate || 1350);

    return {
      totalBuyQuantity: buySummary.totalBuyQuantity,
      totalSellQuantity: sellSummary.totalSellQuantity,
      totalProfit: sellSummary.totalProfit,
    };
  }, [enrichedMemos, visibleTrades, tradeStockFilter, exchangeRate]);
  const memoSummary = useMemo(() => buildTradeSummary(visibleMemos, exchangeRate || 1350), [visibleMemos, exchangeRate]);

  const removeAsset = (id, e) => {
    if (e) e.stopPropagation();
    setAssets(prevAssets => prevAssets.filter(a => a.id !== id));
    addLog("자산이 삭제되었습니다.", "success");
  };

  const removeTrade = (id, e) => {
    if (e) e.stopPropagation();
    setTrades(prevTrades => prevTrades.filter(t => t.id !== id));
    addLog("매매 기록이 삭제되었습니다.", "success");
  };

  const removeMemo = (id, e) => {
    if (e) e.stopPropagation();
    setMemos(prevMemos => prevMemos.filter(memo => memo.id !== id));
    addLog("메모가 삭제되었습니다.", "success");
  };

  const updateMemoText = (id, memoText) => {
    setMemos(prevMemos => prevMemos.map((memo) => (
      memo.id === id
        ? { ...memo, memo: memoText.trim(), updatedAt: new Date().toISOString() }
        : memo
    )));
    addLog('메모가 수정되었습니다.', 'success');
  };

  const addTradeMemo = ({ asset, action, quantity, price, date, memo, realizedPnl = 0 }) => {
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
    setMemos(prevMemos => [{
      id: Date.now() + Math.random(),
      assetId: matchedAsset?.id ?? null,
      name: manualMemo.stockName,
      ticker: matchedAsset?.ticker || manualMemo.ticker,
      category: matchedAsset?.category || '',
      currency: matchedAsset?.currency || manualMemo.currency,
      side: manualMemo.action === '매도' ? 'sell' : 'buy',
      action: manualMemo.action,
      quantity: parseNumber(manualMemo.quantity),
      price: parseNumber(manualMemo.price),
      date: manualMemo.date,
      pnl: parseNumber(manualMemo.realizedPnl),
      memo: manualMemo.memo.trim(),
      createdAt: new Date().toISOString()
    }, ...prevMemos]);

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

  const handleAddBuyToAsset = () => {
  if (!selectedAssetToUpdate) return;

  const addedQty = parseFloat(String(addBuyForm.quantity).replace(/,/g, ''));
  const addedAvgNative = parseFloat(String(addBuyForm.averagePrice).replace(/,/g, ''));

  if (isNaN(addedQty) || addedQty <= 0) {
    addLog("추가 매수 수량을 올바르게 입력해주세요.", "error");
    return;
  }

  if (isNaN(addedAvgNative) || addedAvgNative <= 0) {
    addLog("추가 매수 단가를 올바르게 입력해주세요.", "error");
    return;
  }

  setAssets(prevAssets =>
    prevAssets.map(asset => {
      if (asset.id !== selectedAssetToUpdate.id) return asset;

      const oldQty = Number(asset.quantity) || 0;
      const oldAvgNative = Number(asset.originalAveragePrice || asset.averagePrice) || 0;

      const totalQty = oldQty + addedQty;
      const totalCostNative = oldQty * oldAvgNative + addedQty * addedAvgNative;
      const nextOriginalAveragePrice = totalQty > 0 ? totalCostNative / totalQty : 0;

      const nextAveragePrice =
        asset.currency === 'USD'
          ? Math.round(nextOriginalAveragePrice * (asset.buyExchangeRate || exchangeRate || 1350))
          : nextOriginalAveragePrice;

      const nextBuyDate =
        new Date(addBuyForm.buyDate) < new Date(asset.buyDate)
          ? addBuyForm.buyDate
          : asset.buyDate;

      return {
        ...asset,
        quantity: totalQty,
        averagePrice: nextAveragePrice,
        originalAveragePrice: nextOriginalAveragePrice,
        buyDate: nextBuyDate
      };
    })
  );

  addTradeMemo({
    asset: selectedAssetToUpdate,
    action: '매수',
    quantity: addedQty,
    price: addedAvgNative,
    date: addBuyForm.buyDate,
    memo: addBuyForm.memo
  });

  addLog(`'${selectedAssetToUpdate.name}' 추가 매수 반영 완료`, "success");
  setIsUpdatingAsset(false);
  setSelectedAssetToUpdate(null);
  setAddBuyForm(initialAddBuyState);

  setTimeout(() => {
    setRefreshTrigger(t => t + 1);
  }, 300);
};

  const handleSellAsset = () => {
  if (!selectedAssetToSell) return;

  const sellQty = parseFloat(String(sellForm.quantity).replace(/,/g, ''));
  const sellPriceNative = parseFloat(String(sellForm.sellPrice).replace(/,/g, ''));

  if (isNaN(sellQty) || sellQty <= 0) {
    addLog("매도 수량을 올바르게 입력해주세요.", "error");
    return;
  }

  if (isNaN(sellPriceNative) || sellPriceNative <= 0) {
    addLog("매도 단가를 올바르게 입력해주세요.", "error");
    return;
  }

  const currentQty = Number(selectedAssetToSell.quantity) || 0;
  if (sellQty > currentQty) {
    addLog("보유 수량보다 많이 매도할 수 없습니다.", "error");
    return;
  }

  const avgBuyNative = Number(selectedAssetToSell.originalAveragePrice || selectedAssetToSell.averagePrice) || 0;
  const pnlNative = (sellPriceNative - avgBuyNative) * sellQty;

  const trade = {
    id: Date.now(),
    name: selectedAssetToSell.name,
    category: selectedAssetToSell.category,
    currency: selectedAssetToSell.currency,
    buyDate: selectedAssetToSell.buyDate,
    sellDate: sellForm.sellDate,
    buyPrice: avgBuyNative,
    sellPrice: sellPriceNative,
    quantity: sellQty,
    pnl: pnlNative
  };

  const remainingQty = currentQty - sellQty;

  setTrades(prev => [trade, ...prev]);

  if (remainingQty === 0) {
    setAssets(prev => prev.filter(asset => asset.id !== selectedAssetToSell.id));
  } else {
    setAssets(prev =>
      prev.map(asset =>
        asset.id === selectedAssetToSell.id
          ? { ...asset, quantity: remainingQty }
          : asset
      )
    );
  }

  addTradeMemo({
    asset: selectedAssetToSell,
    action: '매도',
    quantity: sellQty,
    price: sellPriceNative,
    date: sellForm.sellDate,
    memo: sellForm.memo,
    realizedPnl: pnlNative
  });

  addLog(`'${selectedAssetToSell.name}' 매도 반영 완료`, "success");
  setIsSellingAsset(false);
  setSelectedAssetToSell(null);
  setSellForm(initialSellFormState);

  setTimeout(() => {
    setRefreshTrigger(t => t + 1);
  }, 300);
};

  // 자산 추가 처리
  const handleAddAsset = () => {
    if (!newAsset.name || !newAsset.quantity) return;
    if (newAsset.category !== '현금' && !newAsset.averagePrice) return;
    
    const parsedQty = parseFloat(String(newAsset.quantity).replace(/,/g, ''));
  const parsedAvgPrice = newAsset.category === '현금'
    ? 1
    : parseFloat(String(newAsset.averagePrice).replace(/,/g, ''));
  const parsedBuyRate = parseFloat(String(newAsset.buyExchangeRate).replace(/,/g, '')) || (exchangeRate || 1350);

    let krwAveragePrice = parsedAvgPrice;
    if (newAsset.currency === 'USD') krwAveragePrice = Math.round(parsedAvgPrice * parsedBuyRate);

    const asset = {
      id: Date.now(), 
      name: newAsset.name, 
      ticker: newAsset.ticker.toUpperCase(),
      category: newAsset.category, 
      currency: newAsset.currency,
      averagePrice: krwAveragePrice, 
      quantity: parsedQty, 
      currentPrice: krwAveragePrice, 
      originalCurrency: newAsset.currency, 
      originalAveragePrice: parsedAvgPrice, 
      originalCurrentPrice: parsedAvgPrice, 
      buyDate: newAsset.buyDate, 
      buyExchangeRate: parsedBuyRate, 
      color: ASSET_COLORS[assets.length % ASSET_COLORS.length]
    };

    setAssets(prevAssets => [...prevAssets, asset]);
    addTradeMemo({
      asset,
      action: '매수',
      quantity: parsedQty,
      price: parsedAvgPrice,
      date: newAsset.buyDate,
      memo: newAsset.memo
    });
    setNewAsset(initialAssetState);
    setIsAdding(false);
    addLog(`'${asset.name}' 자산 추가됨. 최신 주가로 연동합니다...`, "info");
    
    setTimeout(() => {
      setRefreshTrigger(t => t + 1);
    }, 500); 
  };


  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900 font-sans relative">
      
      {/* 동기화 라이브 피드백 */}
      <SyncStatusToast syncStatus={syncStatus} />

      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <DashboardHeader
          exchangeRate={exchangeRate}
          isFetching={isFetching}
          lastUpdated={lastUpdated}
          onAddAsset={() => setIsAdding(true)}
          onRefresh={() => setRefreshTrigger(t => t + 1)}
        />

        {/* 탭 */}
        <TabNav activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'portfolio' && (
          <div className="grid lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
            {/* SVG 드릴다운 차트 */}
            <div className="lg:col-span-4 bg-white p-6 md:p-10 rounded-[40px] md:rounded-[50px] shadow-sm border border-slate-100 flex flex-col items-center">
              <div className="w-full flex justify-between items-center mb-6 md:mb-8">
                <h2 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2"><PieIcon className="text-blue-600" size={18}/> {selectedCategory ? `${selectedCategory}` : '자산 비중'}</h2>
                {selectedCategory && (
                  <button onClick={() => setSelectedCategory(null)} className="text-[9px] md:text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 md:px-3 md:py-1.5 rounded-full flex items-center gap-1 hover:bg-blue-100 uppercase tracking-widest"><ArrowLeft size={10} /> 메인으로</button>
                )}
              </div>
              <div className="relative w-64 h-64 md:w-80 md:h-80">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90 scale-110">
                  {currentChartData.map((dataItem) => {
                    const strokeDash = `${dataItem.percent} ${100 - dataItem.percent}`;
                    const strokeOffset = -dataItem.startPercent;
                    return (
                      <circle key={dataItem.id || dataItem.name} cx="18" cy="18" r="15.9" fill="transparent" stroke={dataItem.color} strokeWidth="3.2" strokeDasharray={strokeDash} strokeDashoffset={strokeOffset} className={`transition-all duration-700 ease-out ${!selectedCategory ? 'cursor-pointer hover:stroke-[4] hover:opacity-80' : 'opacity-90'}`} onClick={() => !selectedCategory && setSelectedCategory(dataItem.name)} />
                    );
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-4">
                  <span className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mb-1">{selectedCategory ? `${selectedCategory}` : 'Total'}</span>
                  <div className="flex flex-col items-center gap-0.5">
                    {currentCategoryKRW > 0 && <span className="text-base md:text-lg font-black text-slate-900 tracking-tighter">{formatMoney(currentCategoryKRW, 'KRW')}</span>}
                    {currentCategoryKRW > 0 && currentCategoryUSD > 0 && <span className="text-[9px] text-slate-300 font-bold">+</span>}
                    {currentCategoryUSD > 0 && <span className="text-base md:text-lg font-black text-blue-600 tracking-tighter">{formatMoney(currentCategoryUSD, 'USD')}</span>}
                  </div>
                  {isDomesticStockChart ? (
                    <div className={`mt-2 md:mt-3 px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center gap-1.5 ${profitBgTone}`}>
                      <span className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">총 수익금액</span>
                      <span className={`text-[10px] md:text-[11px] font-black ${profitTone}`}>
                        {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 md:mt-3 bg-slate-50 px-2 py-1 md:px-3 md:py-1.5 rounded-full border border-slate-100 flex items-center gap-1.5">
                        <span className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">총 환산가치</span>
                        <span className="text-[10px] md:text-[11px] font-black text-slate-700">≈ {formatMoney(currentCategoryTotalConverted, 'KRW')}</span>
                      </div>
                      <div className={`mt-1.5 px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center gap-1.5 ${profitBgTone}`}>
                        <span className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">총 수익금액</span>
                        <span className={`text-[10px] md:text-[11px] font-black ${profitTone}`}>
                          {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-8 md:mt-12 w-full space-y-2">
                {currentChartData.map(data => (
                  <button key={data.id || data.name} onClick={() => !selectedCategory && setSelectedCategory(data.name)} className={`w-full flex items-center justify-between p-3 md:p-4 rounded-2xl border transition-all ${!selectedCategory ? 'bg-slate-50 border-transparent hover:bg-white hover:shadow-md hover:scale-[1.02]' : 'bg-white border-slate-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shadow-inner" style={{ backgroundColor: data.color }}></div>
                      <span className="text-[11px] md:text-xs font-black text-slate-700">{data.name}</span>
                    </div>
                    <span className="text-[10px] md:text-[11px] font-black text-slate-400">{data.percent.toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            </div>

            {/* List 섹션 */}
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white rounded-[30px] md:rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-6 md:p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                  <h3 className="text-base md:text-lg font-black text-slate-900">{selectedCategory ? `${selectedCategory} 상세 목록` : '보유 자산 상세'}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left table-auto">
                    <thead>
                      <tr className="text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] border-b border-slate-100">
                        <th className="px-4 py-4 md:px-6 md:py-5">종목/자산</th>
                        <th className="px-4 py-4 md:px-6 md:py-5">상세 가치</th>
                        <th className="px-4 py-4 md:px-6 md:py-5 text-right">수익률</th>
                        <th className="px-4 py-4 md:px-6 md:py-5 text-center">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {enhancedAssets.filter(asset => selectedCategory ? asset.category === selectedCategory : true).map((asset) => (
                        <tr key={asset.id} className="hover:bg-slate-50/50 transition-all group">
                          <td className="px-4 py-4 md:px-6 md:py-5 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-[14px] md:rounded-2xl flex items-center justify-center text-white font-black text-sm md:text-lg shadow-md group-hover:scale-110 transition-transform" style={{ backgroundColor: asset.color }}>
                                {asset.category === '현금' ? <Banknote size={16}/> : asset.name[0]}
                              </div>
                              <div className="min-w-max">
                                <p className="font-black text-slate-900 text-xs md:text-sm leading-none">{asset.name}</p>
                                <p className="text-[9px] md:text-[10px] text-slate-400 font-bold mt-1.5 uppercase tracking-widest">
                                  {asset.category === '현금' ? 'CASH' : asset.ticker} {asset.category !== '현금' && `• ${asset.quantity.toLocaleString()}${asset.category==='원자재'?'단위':'주'}`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 md:px-6 md:py-5">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-100 group-hover:border-blue-100 transition-colors w-full min-w-[180px] max-w-[240px]">
                              <div className="flex flex-col">
                                <span className="text-[8px] md:text-[9px] text-slate-400 font-black uppercase tracking-widest">{asset.category === '현금' ? '보유 원금' : '총 매입'}</span>
                                <span className="font-black text-slate-700 text-xs md:text-[13px] mt-0.5">{formatMoney(asset.purchaseNative, asset.currency)}</span>
                              </div>
                              <div className="flex flex-col text-right">
                                {asset.category !== '현금' && (
                                  <><span className="text-[8px] md:text-[9px] text-slate-400 font-black uppercase tracking-widest">평단가</span><span className="font-black text-slate-700 text-xs md:text-[13px] mt-0.5">{formatMoney(asset.originalAveragePrice || asset.averagePrice, asset.originalCurrency || asset.currency)}</span></>
                                )}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[8px] md:text-[9px] text-blue-500 font-black uppercase tracking-widest">총 가치</span>
                                <span className="font-black text-blue-600 text-xs md:text-[13px] mt-0.5 leading-none">{formatMoney(asset.currentNative, asset.currency)}</span>
                              </div>
                              <div className="flex flex-col text-right">
                                {asset.category !== '현금' && (
                                  <><span className="text-[8px] md:text-[9px] text-blue-500 font-black uppercase tracking-widest">현재가</span><span className="font-black text-blue-600 text-xs md:text-[13px] mt-0.5 leading-none">{formatMoney(asset.originalCurrentPrice || asset.currentPrice, asset.originalCurrency || asset.currency)}</span></>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 md:px-6 md:py-5 text-right whitespace-nowrap">
                            {asset.category === '현금' ? <span className="text-[10px] md:text-xs font-black text-slate-300">-</span> : (
                              <div className="flex flex-col items-end gap-1.5">
                                <div className={`inline-flex items-center gap-1 px-3 py-1.5 md:px-4 md:py-2 rounded-[14px] text-[10px] md:text-[11px] font-black ${asset.returnPercent >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                  {asset.returnPercent >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {Math.abs(asset.returnPercent).toFixed(2)}%
                                </div>
                                <div className={`inline-flex px-3 py-1.5 md:px-4 md:py-2 rounded-[14px] text-[10px] md:text-[11px] font-black ${asset.profitNative >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                  {asset.profitNative > 0 ? '+' : ''}{formatMoney(asset.profitNative, asset.currency)}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 md:px-6 md:py-5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            {asset.category !== '현금' && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openAddBuyModal(asset);
                                  }}
                                  className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors p-2 rounded-xl"
                                  title="추가 매수"
                                >
                                  <Plus size={16} className="md:w-[18px] md:h-[18px]" />
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openSellModal(asset);
                                  }}
                                  className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors p-2 rounded-xl"
                                  title="매도"
                                >
                                  <Minus size={16} className="md:w-[18px] md:h-[18px]" />
                                </button>
                              </>
                            )}

                            <button
                              onClick={(e) => removeAsset(asset.id, e)}
                              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors p-2 rounded-xl"
                              title="자산 삭제"
                            >
                              <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
                            </button>
                          </div>
                        </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {enhancedAssets.length === 0 && <p className="p-16 text-center text-slate-400 font-bold text-sm">자산이 없습니다. 종목을 추가해주세요.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 수익 및 기록 탭 */}
        {activeTab === 'history' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            
            <h3 className="text-lg md:text-xl font-black text-slate-800 flex items-center gap-2"><ArrowRightLeft className="text-blue-600" size={20} /> 종목 매매(실현) 수익 요약</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <div className="bg-white p-6 md:p-8 rounded-[30px] border border-slate-100 shadow-sm flex flex-col justify-center">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-50 text-slate-600 rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><Banknote size={20} /></div>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-1">원화 매매 순수익</p>
                <p className={`text-2xl md:text-3xl font-black tracking-tighter ${krwNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {krwNetProfit > 0 ? '+' : ''}{formatMoney(krwNetProfit, 'KRW')}
                </p>
              </div>
              <div className="bg-white p-6 md:p-8 rounded-[30px] border border-slate-100 shadow-sm flex flex-col justify-center">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-50 text-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><DollarSign size={20} /></div>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-1">달러 매매 순수익</p>
                <p className={`text-2xl md:text-3xl font-black tracking-tighter ${usdNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {usdNetProfit > 0 ? '+' : ''}{formatMoney(usdNetProfit, 'USD')}
                </p>
              </div>
              <div className="bg-slate-900 p-6 md:p-8 rounded-[30px] shadow-xl shadow-slate-200 flex flex-col justify-center text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet size={50}/></div>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] mb-1">총 환산 매매 순수익</p>
                <p className={`text-3xl md:text-4xl font-black tracking-tighter ${totalConvertedNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalConvertedNetProfit > 0 ? '+' : ''}{formatMoney(totalConvertedNetProfit, 'KRW')}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 rounded-[30px] md:rounded-[40px] p-6 md:p-8 shadow-xl shadow-slate-200">
              <h3 className="text-white font-black flex items-center gap-2 mb-4 md:mb-6 text-base md:text-lg"><Globe className="text-blue-400" size={18} /> 달러 자산 환차익 분석</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <div className="col-span-1 flex flex-col justify-center md:border-r border-b md:border-b-0 border-slate-700/50 pb-4 md:pb-0 md:pr-6 relative">
                  <div className="absolute top-0 right-2 opacity-10"><DollarSign size={60}/></div>
                  <span className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1.5 md:mb-2">총 매입 금액 (USD)</span>
                  <span className="text-3xl md:text-4xl font-black text-white tracking-tighter">{formatMoney(totalUsdPurchase, 'USD')}</span>
                </div>
                <div className="col-span-2 flex flex-col justify-center gap-3 md:pl-2">
                  <div className="flex justify-between items-center bg-slate-800/50 px-4 md:px-6 py-3 md:py-4 rounded-2xl md:rounded-3xl">
                    <span className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest">평단가 (매수 평균 환율)</span>
                    <span className="text-lg md:text-xl font-black text-white">₩{Math.round(avgBuyExchangeRate).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center bg-blue-900/20 border border-blue-800/30 px-4 md:px-6 py-3 md:py-4 rounded-2xl md:rounded-3xl relative">
                    <div className="flex flex-col">
                      <span className="text-[9px] md:text-[10px] text-blue-400 font-black uppercase tracking-widest">총 현재 원화 환산 가격</span>
                      <span className="text-xl md:text-2xl font-black text-blue-400 tracking-tighter">{formatMoney(currentKrwValueForUsd, 'KRW')}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] md:text-[10px] text-blue-400 font-black uppercase tracking-widest mb-1">환차익 수익률</span>
                      <span className={`inline-flex font-black px-2 py-0.5 md:px-3 md:py-1 rounded-lg md:rounded-xl text-xs md:text-sm ${fxProfitPercent >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                        {fxProfitPercent > 0 ? '+' : ''}{fxProfitPercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 md:p-10 rounded-[30px] md:rounded-[40px] shadow-sm border border-slate-100">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-3 md:gap-4">
                <h3 className="text-lg md:text-xl font-black flex items-center gap-2 md:gap-3">
                  <Receipt className="text-blue-600" size={20}/> 
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
                    <button onClick={() => { setSelectedDividendAsset(null); setDividendFilter('전체'); }} className="text-[9px] md:text-[10px] font-black text-blue-600 bg-blue-50 px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:bg-blue-100 uppercase tracking-widest transition-all">
                      <ArrowLeft size={12} /> 전체 보기
                    </button>
                  </div>
                ) : (
                  <span className="text-[9px] md:text-[10px] bg-blue-50 text-blue-600 px-2 py-1 md:px-3 md:py-1.5 rounded-full font-black tracking-widest uppercase">
                    매수일 기준 자동 추출
                  </span>
                )}
              </div>

              {!selectedDividendAsset ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {dividendSummary.length > 0 ? dividendSummary.map(summary => (
                    <div 
                      key={summary.name} 
                      onClick={() => setSelectedDividendAsset(summary.name)} 
                      className="p-5 md:p-6 bg-slate-50 rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 cursor-pointer hover:bg-white hover:shadow-xl hover:shadow-slate-100/50 hover:scale-[1.02] transition-all group"
                    >
                      <div className="flex justify-between items-start mb-4 md:mb-6">
                        <div className="whitespace-nowrap overflow-hidden pr-3 md:pr-4">
                          <h4 className="font-black text-slate-800 text-base md:text-lg group-hover:text-blue-600 transition-colors truncate">{summary.name}</h4>
                          <p className="text-[9px] md:text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">상세 보기</p>
                        </div>
                        <div className="text-right whitespace-nowrap shrink-0">
                          <p className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest mb-0.5 md:mb-1">총 누적 배당금</p>
                          <p className="text-lg md:text-xl font-black text-blue-600">{formatMoney(summary.totalAmount, summary.currency)}</p>
                        </div>
                      </div>
                      
                      <div className={`inline-flex items-center px-3 py-1.5 md:px-4 md:py-2 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-black tracking-widest ${summary.status.includes('완료') ? 'bg-emerald-50 text-emerald-600' : summary.status.includes('이번 달') ? 'bg-blue-50 text-blue-600' : 'bg-slate-200/50 text-slate-500'}`}>
                        {summary.status} {summary.status.includes('예정') && `(≈ ${formatMoney(summary.expectedAmount, summary.currency)})`}
                      </div>
                    </div>
                  )) : (
                    <div className="col-span-full py-8 md:py-12 text-center text-slate-400 font-bold text-xs md:text-sm">
                      {isFetching ? '배당 데이터를 갱신 중입니다...' : '매수일 이후 배당 내역이 없거나 데이터를 불러올 수 없습니다.'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-50 rounded-[2rem] md:rounded-[2.5rem] p-1 md:p-2 border border-slate-100">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left table-auto">
                      <thead className="text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em] border-b border-slate-200/50">
                        <tr>
                          <th className="px-4 py-4 md:px-8 md:py-5">지급 일자</th>
                          <th className="px-4 py-4 md:px-8 md:py-5">종목명</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-right">지급 금액</th>
                          <th className="px-4 py-4 md:px-8 md:py-5 text-center">상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/50">
                        {filteredHistory.length > 0 ? filteredHistory.map(div => (
                          <tr key={div.id} className="hover:bg-white transition-colors group">
                            <td className="px-4 py-4 md:px-8 md:py-5 text-xs md:text-sm font-bold text-slate-500 whitespace-nowrap">{div.date}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-sm md:text-base font-black text-slate-800 whitespace-nowrap">{div.name}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-right text-sm md:text-base font-black text-blue-600 whitespace-nowrap">{formatMoney(div.amount, div.currency)}</td>
                            <td className="px-4 py-4 md:px-8 md:py-5 text-center whitespace-nowrap">
                              <span className="text-[9px] md:text-[10px] bg-emerald-50 text-emerald-600 px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl font-black tracking-widest uppercase">지급 완료</span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="4" className="px-4 py-12 md:px-8 md:py-16 text-center">
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

            <div className="bg-white rounded-[30px] md:rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 md:p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                <h3 className="text-base md:text-lg font-black text-slate-900">과거 매매 기록</h3>
              </div>
              <div className="p-5 md:p-6 border-b border-slate-50 bg-white space-y-4">
                <div className="flex flex-col md:flex-row gap-3">
                  <select
                    value={tradeStockFilter}
                    onChange={(e) => setTradeStockFilter(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-slate-700"
                  >
                    <option value="all">?? ??</option>
                    {tradeStockOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={tradeSortMode}
                    onChange={(e) => setTradeSortMode(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-slate-700"
                  >
                    {TRADE_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">? ?? ??</p>
                    <p className="text-lg font-black text-slate-800">{tradeSummary.totalBuyQuantity.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">? ?? ??</p>
                    <p className="text-lg font-black text-slate-800">{tradeSummary.totalSellQuantity.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">? ??</p>
                    <p className={`text-lg font-black ${tradeSummary.totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tradeSummary.totalProfit > 0 ? '+' : ''}{formatMoney(tradeSummary.totalProfit, 'KRW')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left table-auto">
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
                    {visibleTrades.map((trade) => (
                      <tr key={trade.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-4 md:px-8 md:py-6 text-sm md:text-base font-black text-slate-800 whitespace-nowrap">{trade.name}</td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-[10px] md:text-xs text-slate-500 font-bold space-y-1 whitespace-nowrap">
                          <div><span className="text-slate-400 mr-1 md:mr-2">매수:</span>{trade.buyDate}</div>
                          <div><span className="text-slate-400 mr-1 md:mr-2">매도:</span>{trade.sellDate}</div>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-black text-slate-700 space-y-1 whitespace-nowrap">
                          <div>{formatMoney(trade.buyPrice, trade.currency)}</div>
                          <div className="text-slate-400">{formatMoney(trade.sellPrice, trade.currency)}</div>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                          <span className={`inline-flex font-black px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl text-[10px] md:text-xs ${trade.pnl >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {trade.pnl > 0 ? '+' : ''}{formatMoney(trade.pnl, trade.currency)}
                          </span>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-center whitespace-nowrap">
                          <button onClick={(e) => removeTrade(trade.id, e)} className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors p-1.5 md:p-2 rounded-xl" title="기록 삭제"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleTrades.length === 0 && <p className="p-8 md:p-10 text-center text-slate-400 font-bold text-xs md:text-sm">??? ?? ??? ????.</p>}
              </div>
            </div>

          </div>
        )}

        {activeTab === 'notes' && (
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
        )}
      </div>

      {/* 자산 추가 모달 */}
{isAdding && (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white w-full max-w-md rounded-[30px] md:rounded-[40px] p-6 md:p-8 shadow-2xl animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
      <div className="flex justify-between items-center mb-6 md:mb-8 sticky top-0 bg-white z-10 pt-2 pb-2">
        <h3 className="text-lg md:text-xl font-black text-slate-900">새 자산 등록</h3>
        <button
          onClick={() => setIsAdding(false)}
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
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
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
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
              value={newAsset.currency}
              onChange={(e) => setNewAsset({ ...newAsset, currency: e.target.value })}
            >
              <option value="KRW">원화 (KRW)</option>
              <option value="USD">달러 (USD)</option>
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
              className="w-full pl-11 pr-4 py-2.5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm"
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
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold uppercase text-xs md:text-sm text-blue-700"
              value={newAsset.ticker}
              onChange={(e) => setNewAsset({ ...newAsset, ticker: e.target.value.toUpperCase() })}
            />
          </div>
        )}

        {newAsset.category !== '현금' && (
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
              평균 단가 ({newAsset.currency === 'USD' ? '$' : '₩'})
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-black text-blue-600 text-xs md:text-sm"
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
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-black text-blue-600 text-xs md:text-sm"
            value={formatInputNumber(newAsset.quantity)}
            onChange={(e) =>
              setNewAsset({
                ...newAsset,
                quantity: sanitizeNumericInput(e.target.value)
              })
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-4 border-t border-slate-100 pt-4 mt-2">
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 text-blue-500">
              매수일
            </label>
            <input
              type="date"
              className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-blue-50/50 border border-blue-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-blue-800"
              value={newAsset.buyDate}
              onChange={(e) => setNewAsset({ ...newAsset, buyDate: e.target.value })}
            />
          </div>

          {newAsset.currency === 'USD' && (
            <div>
              <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 text-emerald-500">
                매수 당시 환율
              </label>
              <input
                type="text"
                inputMode="decimal"
                className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-emerald-50/50 border border-emerald-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-emerald-600 font-black text-xs md:text-sm text-emerald-800"
                value={formatInputNumber(newAsset.buyExchangeRate)}
                onChange={(e) =>
                  setNewAsset({
                    ...newAsset,
                    buyExchangeRate: sanitizeNumericInput(e.target.value)
                  })
                }
              />
            </div>
          )}
        </div>


        <div>
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            매수 메모
          </label>
          <textarea
            rows="3"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm resize-none"
            placeholder="매수 근거를 간단히 남겨두세요."
            value={newAsset.memo}
            onChange={(e) => setNewAsset({ ...newAsset, memo: e.target.value })}
          />
        </div>
        <button
          onClick={handleAddAsset}
          className="w-full mt-6 px-6 py-3.5 md:py-4 bg-slate-900 text-white rounded-xl md:rounded-2xl font-black text-xs md:text-sm shadow-xl shadow-slate-200 hover:scale-[1.02] transition-all uppercase tracking-widest"
        >
          포트폴리오에 반영하기
        </button>
      </div>
    </div>
  </div>
)}

{/* 추가 매수 모달 */}
{isUpdatingAsset && selectedAssetToUpdate && (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white w-full max-w-md rounded-[30px] md:rounded-[40px] p-6 md:p-8 shadow-2xl animate-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <h3 className="text-lg md:text-xl font-black text-slate-900">
          {selectedAssetToUpdate.name} 추가 매수
        </h3>
        <button
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
            추가 매수 단가 ({selectedAssetToUpdate.currency === 'USD' ? '$' : '₩'})
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-black text-blue-600 text-xs md:text-sm"
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
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-black text-blue-600 text-xs md:text-sm"
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
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 text-blue-500">
            추가 매수일
          </label>
          <input
            type="date"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-blue-50/50 border border-blue-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-blue-800"
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
            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm resize-none"
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
        className="w-full mt-6 px-6 py-3.5 md:py-4 bg-slate-900 text-white rounded-xl md:rounded-2xl font-black text-xs md:text-sm shadow-xl shadow-slate-200 hover:scale-[1.02] transition-all uppercase tracking-widest"
      >
        추가 매수 반영하기
      </button>
    </div>
  </div>
)}

{/* 매도 모달 */}
{isSellingAsset && selectedAssetToSell && (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white w-full max-w-md rounded-[30px] md:rounded-[40px] p-6 md:p-8 shadow-2xl animate-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center gap-4 mb-6 md:mb-8">
        <h3 className="text-lg md:text-xl font-black text-slate-900 whitespace-nowrap">
          {selectedAssetToSell.name} 매도
        </h3>
        <button
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
            매도 단가 ({selectedAssetToSell.currency === 'USD' ? '$' : '₩'})
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-black text-blue-600 text-xs md:text-sm"
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
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-black text-blue-600 text-xs md:text-sm"
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
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 text-blue-500">
            매도일
          </label>
          <input
            type="date"
            className="w-full px-4 py-2.5 md:px-5 md:py-3 bg-blue-50/50 border border-blue-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm text-blue-800"
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
            className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 font-bold text-xs md:text-sm resize-none"
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
        className="w-full mt-6 px-6 py-3.5 md:py-4 bg-slate-900 text-white rounded-xl md:rounded-2xl font-black text-xs md:text-sm shadow-xl shadow-slate-200 hover:scale-[1.02] transition-all uppercase tracking-widest"
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
