import { useMemo } from 'react';
import { getCategoryColor, getCategoryDetailColor } from '../constants.js';
import { getDividendExDate, getDividendReportingDate } from '../utils/dividendDates.js';
import { sortDividendRecordsNewestFirst } from '../utils/dividendRecords.js';
import { calculateAnnualDividendYield } from '../utils/annualDividendYield.js';
import {
  buildCanonicalTradeRows,
  buildKrwCostBasisByAsset,
  buildPositionFromTradeRows,
  getTradeAssetKey,
  getTradeRound,
} from '../utils/tradeReconciliation.js';

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
/**
 * 매수 시점 환율(기록에 저장된 fxRate). 원화 원가·실현손익 계산의 기준이며,
 * 헤더 합계와 종목별 카드가 같은 값을 쓰도록 반드시 공유해야 한다.
 */
const resolveRecordBuyKrwRate = (record) => {
  const currency = record?.currency || 'KRW';
  if (currency === 'KRW') return 1;
  const storedRate = Number(record?.fxRate);
  return Number.isFinite(storedRate) && storedRate > 0 ? storedRate : 0;
};

const getRecordKrwPnl = (record = {}, rateByCurrency) => {
  const exactKrwPnl = Number(record.krwPnl);
  if (record.krwPnl !== null && record.krwPnl !== undefined && Number.isFinite(exactKrwPnl)) {
    return exactKrwPnl;
  }
  return (Number(record.pnl) || 0) * getRecordKrwRate(record, rateByCurrency);
};

/**
 * 월 단위로 날짜를 옮기되 말일을 넘기지 않는다.
 * setMonth(getMonth() + 1)은 1월 31일에서 3월 3일로 튀어서 2월을 통째로 건너뛴다.
 */
const addMonthsClamped = (date, months) => {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const day = date.getDate();
  const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();

  return new Date(year, month, Math.min(day, lastDayOfTargetMonth));
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
  receivedDividends = [],
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
       * 원금은 실제 매수 시점의 원화 투입액으로 고정하고, 현재 평가는 오늘 환율로 본다.
       * 토스 같은 증권사 앱의 원화 화면도 이 구조라 원화 손익에는 환율 변동이 함께 들어간다.
       */
      const displayKrwRate = purchaseNative > 0 && purchaseKRW > 0
        ? purchaseKRW / purchaseNative
        : krwRate;
      const currentKRW = currentNative * krwRate;

      const profitNative = currentNative - purchaseNative;
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
      resolveKrwRate: resolveRecordBuyKrwRate,
    })
  ), [tradeLedger, trades]);
  const realizedRecords = useMemo(() => canonicalTradeRows.filter(record => record.side === 'sell'), [canonicalTradeRows]);
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
  // 연 수익률이 "그 시점에 실현된 손익"으로 반영할 때 쓰는, 날짜가 붙은 실현손익
  // 목록. 헤더 합계(totalConvertedNetProfit)와 완전히 같은 계산(같은 환율 규칙)을
  // 재사용해야 두 화면의 숫자가 서로 어긋나지 않는다.
  // 렌더마다 새 배열을 만들면 이 값을 의존성으로 쓰는 연 수익률 계산이 매번 통째로
  // 다시 돌아 화면이 불필요하게 요동친다. 실제 입력이 바뀔 때만 새로 만든다.
  const realizedGainKrwEvents = useMemo(() => realizedRecords
    .map((record) => ({ date: record.date, amountKRW: getRecordKrwPnl(record, realizedKrwRate) }))
    .filter((event) => event.date && Number.isFinite(event.amountKRW)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [realizedRecords, exchangeRate, jpyKrwRate, currencyRates]);

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
    [...enhancedAssets, ...ledgerRows, ...receivedDividends].forEach((record) => {
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
      // 환율 해석기를 빼먹으면 이미 계산된 krwPnl이 null로 덮여, 종목 카드의 실현손익만
      // "손익 × 오늘 환율"로 근사돼 헤더 합계와 어긋나고 매일 값이 흔들린다.
      const position = buildPositionFromTradeRows(tradeRows, {
        resolveKrwRate: resolveRecordBuyKrwRate,
      });
      const sellRows = position.rows.filter(record => record.side === 'sell');
      const buyRows = position.rows.filter(record => record.side === 'buy');
      const dividendRows = receivedDividends.filter((dividend) => {
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
      // amount가 비어 있는 기록 한 건이면 이 종목의 배당·합계가 통째로 NaN이 된다.
      const dividendKRW = dividendRows.reduce((sum, dividend) => (
        sum + ((Number(dividend.amount) || 0) * getRecordKrwRate(dividend, getRecordRate))
      ), 0);
      const totalKRW = unrealizedKRW + realizedKRW + dividendKRW;

      const unrealizedNative = assetRows.reduce((sum, asset) => sum + asset.profitNative, 0);
      const realizedNative = sellRows
        .filter(trade => trade.currency === currency)
        .reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
      const dividendNative = dividendRows
        .filter(dividend => dividend.currency === currency)
        .reduce((sum, dividend) => sum + (Number(dividend.amount) || 0), 0);

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
        unrealizedNative,
        realizedNative,
        dividendNative,
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
  }, [enhancedAssets, canonicalTradeRows, receivedDividends, exchangeRate, jpyKrwRate, currencyRates]);

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
      activeDividendAssets.set(entry.name, { asset: asset || entry, registry: entry });
    });

    assets.forEach(asset => {
      const assetDivs = sortDividendRecordsNewestFirst(
        autoDividends.filter(d => d.name === asset.name),
      );
      if (assetDivs.length > 0) activeDividendAssets.set(asset.name, { asset, registry: null });
    });

    autoDividends.forEach((dividend) => {
      if (!dividend?.name || activeDividendAssets.has(dividend.name)) return;
      activeDividendAssets.set(dividend.name, {
        asset: assets.find((candidate) => candidate.name === dividend.name) || dividend,
        registry: null,
      });
    });

    receivedDividends.forEach((dividend) => {
      if (!dividend?.name || activeDividendAssets.has(dividend.name)) return;
      activeDividendAssets.set(dividend.name, {
        asset: assets.find((candidate) => candidate.name === dividend.name) || dividend,
        registry: null,
      });
    });

    activeDividendAssets.forEach(({ asset, registry }) => {
      const assetDivs = sortDividendRecordsNewestFirst(
        autoDividends.filter(d => d.name === asset.name),
      );
      const receivedAssetDivs = receivedDividends.filter(d => (
        d.name === asset.name && (Number(d.amount) || 0) > 0
      ));
      const currentAsset = assets.find((candidate) => (
        candidate.name === asset.name && parseMetricNumber(candidate.quantity) > 0
      ));
      const isCurrentHolding = Boolean(currentAsset);

      // 매도한 종목은 자동 배당 피드나 과거 레지스트리만 남아 있다는 이유로
      // 목록에 두지 않는다. 실제 수령한 배당이 있을 때만 과거 내역으로 보존한다.
      if (!isCurrentHolding && receivedAssetDivs.length === 0) return;

      if (assetDivs.length === 0 && receivedAssetDivs.length === 0) {
        summary[asset.name] = {
          name: asset.name,
          ticker: asset.ticker || registry?.ticker || '',
          category: asset.category || registry?.category || '',
          currency: asset.currency || registry?.currency || 'KRW',
          isCurrentHolding,
          totalAmount: 0,
          status: '배당락 기록 대기',
          expectedAmount: 0,
          expectedAnnualAmount: 0,
          annualDividendYieldPercent: null,
          history: [],
        };
        return;
      }

      const totalAmount = receivedAssetDivs.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
      let status = '';
      let expectedAmount = 0;

      const lastDiv = assetDivs[0] || receivedAssetDivs[0];
      const lastDate = new Date(`${getDividendExDate(lastDiv)}T00:00:00`);
      const lastReportingDateKey = getDividendReportingDate(lastDiv);
      const lastReportingDate = new Date(`${lastReportingDateKey}T00:00:00`);
      const currentQuantity = isCurrentHolding ? parseMetricNumber(currentAsset.quantity) : 0;
      const lastDividendQuantity = Number(lastDiv.quantity) || 0;
      const perShareNetAmount = Number(lastDiv.perShareNetAmount)
        || (lastDividendQuantity > 0 ? lastDiv.amount / lastDividendQuantity : 0);
      expectedAmount = perShareNetAmount * currentQuantity;

      let monthDiff = 3; 
      if (assetDivs.length > 1) {
        const prevDate = new Date(`${getDividendExDate(assetDivs[1])}T00:00:00`);
        const daysDiff = (lastDate - prevDate) / (1000 * 60 * 60 * 24);
        if (daysDiff >= 20 && daysDiff <= 45) monthDiff = 1;
        else if (daysDiff >= 80 && daysDiff <= 110) monthDiff = 3;
        else if (daysDiff >= 150 && daysDiff <= 200) monthDiff = 6;
        else if (daysDiff >= 330) monthDiff = 12;
      }

      // 배당락일을 모르는 기록(지급일만 있는 수입 내역 등)은 다음 배당을 예측할 수 없다.
      // 예전에는 Invalid Date가 그대로 흘러 "NaN월 배당락 예상"이 화면에 떴다.
      const hasLastExDate = Number.isFinite(lastDate.getTime());
      const nextDate = hasLastExDate ? addMonthsClamped(lastDate, monthDiff) : null;
      const nextMonth = nextDate ? nextDate.getMonth() + 1 : 0;
      const nextYear = nextDate ? nextDate.getFullYear() : 0;
      const currentEnhancedAsset = enhancedAssets.find((candidate) => candidate.name === asset.name);
      const {
        expectedAnnualAmount,
        annualDividendYieldPercent,
      } = calculateAnnualDividendYield({
        expectedPaymentAmount: expectedAmount,
        intervalMonths: monthDiff,
        currentValue: currentEnhancedAsset?.currentNative,
      });

      if (!isCurrentHolding) {
        status = '과거 보유 · 수령 내역';
      } else if (
        Number.isFinite(lastReportingDate.getTime())
        && lastReportingDate.getMonth() + 1 === currentMonth
        && lastReportingDate.getFullYear() === currentYear
      ) {
        status = '이번 달 배당 반영';
      } else if (!nextDate) {
        status = '다음 배당 일정 미확인';
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
        isCurrentHolding,
        totalAmount,
        status,
        expectedAmount,
        expectedAnnualAmount: isCurrentHolding ? expectedAnnualAmount : 0,
        annualDividendYieldPercent: isCurrentHolding ? annualDividendYieldPercent : null,
        // Detail history is a receipt ledger, not a forecast. Keep future events in
        // assetDivs for the next-dividend estimate, but never list them as received.
        history: sortDividendRecordsNewestFirst(receivedAssetDivs),
      };
    });
    
    return Object.values(summary).sort((a, b) => {
      const categoryDelta = getDividendCategoryOrder(a.category) - getDividendCategoryOrder(b.category);
      if (categoryDelta !== 0) return categoryDelta;
      return b.totalAmount - a.totalAmount;
    });
  }, [autoDividends, receivedDividends, assets, dividendAssetRegistry, enhancedAssets]);

  const filteredHistory = useMemo(() => {
    if (!selectedDividendAsset) return [];
    const summary = dividendSummary.find(s => s.name === selectedDividendAsset);
    if (!summary) return [];
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

      const seen = new Set();
      return sortDividendRecordsNewestFirst(summary.history.filter((d, index) => {
        const divDate = new Date(`${getDividendReportingDate(d)}T00:00:00`);
        const matchesFilter = dividendFilter === '이번 달'
          ? divDate.getFullYear() === currentYear && divDate.getMonth() === currentMonth
          : dividendFilter === '올해'
            ? divDate.getFullYear() === currentYear
            : true;
        if (!matchesFilter) return false;
        /**
         * 배당락일이 없는 기록(지급일만 있는 수입 내역)은 예전에 키가
         * "JEPI::undefined::USD"로 전부 같아져서, 서로 다른 달의 배당이
         * 상세 표에서만 사라지고 합계에는 남는 불일치가 생겼다.
         * 식별에 쓸 수 있는 날짜가 없으면 기록 자체를 키로 삼는다.
         */
        const dateKey = d.exDate || d.date || getDividendReportingDate(d);
        const identity = d.id ?? d.sourceId ?? '';
        const key = dateKey
          ? [d.ticker || d.name, dateKey, d.currency].join('::')
          : `id::${identity || index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
  }, [dividendSummary, selectedDividendAsset, dividendFilter]);

  // 자산 및 기록 삭제 로직 강화 
  return {
    enhancedAssets,
    // 매수·매도가 이동평균으로 정리된 표준 거래 행. 세금 계산도 이 값을 쓴다.
    canonicalTradeRows,
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
    realizedGainKrwEvents,
    stockPerformanceSummary,
    dividendSummary,
    filteredHistory,
  };
};
