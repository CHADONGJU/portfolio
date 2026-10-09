import { isPortfolioAssetCategory } from '../constants.js';
import { getTargetItemCurrency, normalizeInputTicker } from './currencies.js';
import { getCachedKrwRate } from './exchangeRates.js';
import { parseNumber } from './formatters.js';

export const DEFAULT_TARGET_PORTFOLIO = {
  budget: '',
  setupStarted: false,
  categories: [
    { id: '국내주식', percent: 0 },
    { id: '해외주식', percent: 0 },
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

const numberOrZero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const positiveWeight = (value) => Math.max(0, numberOrZero(value));
export const normalizeTargetTicker = (ticker) => normalizeInputTicker(ticker)
  .replace(/^(\d{6})\.(KS|KQ)$/, '$1')
  .replace(/^(\d{4})\.T$/, '$1');
const securityKey = (item) => normalizeTargetTicker(item.ticker) || String(item.name || '').trim().toLowerCase();
export const areTargetStocksSame = (left, right) => {
  const leftTicker = normalizeTargetTicker(left.ticker);
  const rightTicker = normalizeTargetTicker(right.ticker);
  if (leftTicker && rightTicker) return leftTicker === rightTicker;
  const leftName = String(left.name || '').trim().toLowerCase();
  return Boolean(leftName) && leftName === String(right.name || '').trim().toLowerCase();
};

export const getTargetBudgetKRW = (targetPortfolio, totalConvertedKRW) => targetPortfolio.budgetMode === 'custom'
  ? parseNumber(targetPortfolio.budget)
  : targetPortfolio.budgetMode === 'current' ? totalConvertedKRW : (parseNumber(targetPortfolio.budget) || totalConvertedKRW);

// 구버전 종목 비중은 상대 가중치였다. 읽을 때만 당시의 실효 비중으로 바꾸고,
// 정밀도를 유지하여 저장된 목표 금액이 달라지지 않도록 한다.
const readTargetGroup = (group) => {
  const items = group.items || [];
  if (group.allocationMode === 'percent') return { ...group, items };
  const total = items.reduce((sum, item) => sum + numberOrZero(item.percent), 0);
  return {
    ...group,
    allocationMode: 'percent',
    items: items.map((item) => ({ ...item, percent: total > 0 ? numberOrZero(item.percent) / total * 100 : 0 })),
  };
};

export const getTargetGroups = (targetPortfolio, categoryId) => {
  const savedGroups = targetPortfolio.groups?.[categoryId] || [];
  const legacyItems = targetPortfolio.items?.[categoryId] || [];

  if (savedGroups.length > 0) {
    return savedGroups.map(readTargetGroup);
  }

  if (legacyItems.length > 0) {
    return [readTargetGroup({
      id: `${categoryId}-default-group`,
      name: '직접 설정',
      percent: 100,
      isDefault: true,
      items: legacyItems,
    })];
  }

  return [];
};

// 0.1% 단위 1,000개를 배분한다. 개별 반올림으로 99.9%/100.1%가 되는 것을 피한다.
export const normalizeTargetPercents = (entries, getPercent = (entry) => entry.percent) => {
  if (!entries.length) return [];
  const weights = entries.map((entry) => positiveWeight(getPercent(entry)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((weight) => total > 0 ? weight / total * 1000 : 1000 / entries.length);
  const units = exact.map(Math.floor);
  const remainderOrder = exact.map((value, index) => ({ index, remainder: value - units[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = 1000 - units.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index += 1) units[remainderOrder[index].index] += 1;
  return units.map((value) => value / 10);
};

// 계좌는 유지하되, 목표 입력에서는 같은 종목을 한 번만 선택할 수 있게 합친다.
export const getTargetHoldingOptions = (enhancedAssets, categoryId) => {
  const bySecurity = new Map();
  enhancedAssets.filter((asset) => asset.category === categoryId).forEach((asset) => {
    const key = securityKey(asset) || `asset:${asset.id}`;
    const existing = bySecurity.get(key);
    if (existing) {
      existing.currentKRW += numberOrZero(asset.currentKRW);
      existing.quantity += numberOrZero(asset.quantity);
      existing.assetIds.push(asset.id);
      if (!(existing.nativeCurrentPrice > 0) && asset.nativeCurrentPrice > 0) existing.nativeCurrentPrice = asset.nativeCurrentPrice;
    } else {
      bySecurity.set(key, {
        ...asset,
        id: `${categoryId}:${key}`,
        ticker: normalizeInputTicker(asset.ticker),
        currency: getTargetItemCurrency(categoryId, asset.ticker, asset.currency),
        currentKRW: numberOrZero(asset.currentKRW),
        quantity: numberOrZero(asset.quantity),
        assetIds: [asset.id],
      });
    }
  });
  return [...bySecurity.values()].sort((a, b) => b.currentKRW - a.currentKRW);
};

export const buildTargetPortfolioFromHoldings = (previous, enhancedAssets) => {
  const categoryIds = [...new Set(enhancedAssets.map((asset) => asset.category))].filter(isPortfolioAssetCategory);
  if (!categoryIds.length) categoryIds.push('국내주식', '해외주식');
  const optionsByCategory = Object.fromEntries(categoryIds.map((id) => [id, getTargetHoldingOptions(enhancedAssets, id)]));
  const categoryPercents = normalizeTargetPercents(categoryIds, (id) => optionsByCategory[id].reduce((sum, asset) => sum + asset.currentKRW, 0));
  const categories = categoryIds.map((id, index) => ({ id, percent: categoryPercents[index] }));
  const groups = Object.fromEntries(categories.map(({ id }) => {
    const holdings = optionsByCategory[id];
    const itemPercents = normalizeTargetPercents(holdings, (asset) => asset.currentKRW);
    return [id, holdings.length ? [{
      id: `${id}-default-group`, name: '직접 설정', isDefault: true, allocationMode: 'percent', percent: 100,
      items: holdings.map((asset, index) => ({
        id: `${id}-holding-${index}`, name: asset.name || asset.ticker || '', ticker: asset.ticker || '',
        currency: asset.currency, percent: itemPercents[index], price: '', nativePrice: asset.nativeCurrentPrice || '',
      })),
    }] : []];
  }));
  return { ...previous, setupStarted: true, budgetMode: 'current', budget: '', categories, groups, items: Object.fromEntries(categoryIds.map((id) => [id, []])) };
};

export const buildTargetPortfolioGuide = ({
  targetPortfolio, enhancedAssets = [], totalConvertedKRW = 0, exchangeRate, jpyKrwRate, currencyRates,
}) => {
  const targetBudgetKRW = getTargetBudgetKRW(targetPortfolio, totalConvertedKRW);
  const toKrwPrice = (nativePrice, currency) => numberOrZero(nativePrice) * getCachedKrwRate(currency, currencyRates, exchangeRate || 1350, jpyKrwRate || 9.5);
  const toNativePrice = (krwPrice, currency) => krwPrice / getCachedKrwRate(currency, currencyRates, exchangeRate || 1350, jpyKrwRate || 9.5);
  return targetPortfolio.categories.map((categoryTarget) => {
    const categoryAssets = enhancedAssets.filter((asset) => asset.category === categoryTarget.id);
    const currentValue = categoryAssets.reduce((sum, asset) => sum + numberOrZero(asset.currentKRW), 0);
    const targetValue = targetBudgetKRW * numberOrZero(categoryTarget.percent) / 100;
    const groups = getTargetGroups(targetPortfolio, categoryTarget.id);
    const matchedAssets = new Set();
    const seenSecurities = new Set();
    const enrichedGroups = groups.map((group) => {
      const groupTargetValue = targetValue * numberOrZero(group.percent) / 100;
      const enrichedItems = group.items.map((item) => {
        const key = securityKey(item);
        const duplicate = Boolean(key && seenSecurities.has(key));
        if (key) seenSecurities.add(key);
        const matchingAssets = categoryAssets.filter((asset) => areTargetStocksSame(item, asset));
        const itemAssets = matchingAssets.filter((asset) => !matchedAssets.has(asset));
        itemAssets.forEach((asset) => matchedAssets.add(asset));
        const matchedAsset = matchingAssets.find((asset) => asset.nativeCurrentPrice > 0) || matchingAssets[0];
        const itemCurrency = getTargetItemCurrency(categoryTarget.id, item.ticker, item.currency || matchedAsset?.currency);
        const currentItemValue = itemAssets.reduce((sum, asset) => sum + numberOrZero(asset.currentKRW), 0);
        const itemTargetValue = groupTargetValue * numberOrZero(item.percent) / 100;
        const gapValue = itemTargetValue - currentItemValue;
        const storedPrice = parseNumber(item.price) || toKrwPrice(parseNumber(item.nativePrice), itemCurrency);
        const currentPriceKRW = matchedAsset ? toKrwPrice(matchedAsset.nativeCurrentPrice, matchedAsset.currency || itemCurrency) : storedPrice;
        const currentPriceNative = matchedAsset ? numberOrZero(matchedAsset.nativeCurrentPrice) : (parseNumber(item.nativePrice) || toNativePrice(currentPriceKRW, itemCurrency));
        return {
          ...item, currency: itemCurrency, currentValue: currentItemValue, targetValue: itemTargetValue,
          gapValue, currentPriceKRW, currentPriceNative,
          overallPercent: numberOrZero(categoryTarget.percent) * numberOrZero(group.percent) * numberOrZero(item.percent) / 10000,
          quantityToBuy: gapValue > 0 && currentPriceKRW > 0 ? gapValue / currentPriceKRW : 0,
          quantityToSell: gapValue < 0 && currentPriceKRW > 0 ? Math.abs(gapValue) / currentPriceKRW : 0,
          adjustmentSide: gapValue > 0 ? 'buy' : gapValue < 0 ? 'sell' : 'hold',
          adjustmentQuantity: currentPriceKRW > 0 ? Math.abs(gapValue) / currentPriceKRW : null,
          matchedQuantity: itemAssets.reduce((sum, asset) => sum + numberOrZero(asset.quantity), 0),
          isMatched: Boolean(matchedAsset), isDuplicate: duplicate || itemAssets.length < matchingAssets.length,
        };
      });
      return {
        ...group, targetValue: groupTargetValue,
        currentValue: enrichedItems.reduce((sum, item) => sum + item.currentValue, 0),
        itemTotalPercent: enrichedItems.reduce((sum, item) => sum + numberOrZero(item.percent), 0), items: enrichedItems,
      };
    });
    const unassignedAssets = categoryAssets.filter((asset) => !matchedAssets.has(asset));
    return {
      ...categoryTarget, currentValue, targetValue, gapValue: targetValue - currentValue,
      currentPercent: totalConvertedKRW > 0 ? currentValue / totalConvertedKRW * 100 : 0,
      groupTotalPercent: groups.reduce((sum, group) => sum + numberOrZero(group.percent), 0), groups: enrichedGroups,
      buyCount: enrichedGroups.reduce((sum, group) => sum + group.items.filter((item) => item.adjustmentSide === 'buy' && Math.abs(item.gapValue) > 1).length, 0),
      sellCount: enrichedGroups.reduce((sum, group) => sum + group.items.filter((item) => item.adjustmentSide === 'sell' && Math.abs(item.gapValue) > 1).length, 0),
      unassignedAssets, unassignedValue: unassignedAssets.reduce((sum, asset) => sum + numberOrZero(asset.currentKRW), 0),
    };
  });
};

export const getTargetPlanIssues = (guide, totalPercent, budget) => {
  const issues = [];
  const checkTotal = (label, percent) => {
    const difference = Math.round((numberOrZero(percent) - 100) * 1000) / 1000;
    if (difference < -0.001) issues.push(`${label}: ${Number((-difference).toFixed(1))}%를 더 배분해 주세요.`);
    if (difference > 0.001) issues.push(`${label}: ${Number(difference.toFixed(1))}% 초과했어요. 비중을 줄여 주세요.`);
  };
  if (!Number.isFinite(parseNumber(budget)) || !(parseNumber(budget) > 0)) issues.push('목표를 계산할 총금액을 입력해 주세요.');
  checkTotal('전체 자산 비중', totalPercent);
  guide.forEach((category) => {
    if (!Number.isFinite(Number(category.percent)) || Number(category.percent) < 0) issues.push(`${category.id}: 비중은 0 이상의 숫자로 입력해 주세요.`);
    const groups = category.groups || [];
    if (!groups.length) return;
    if (numberOrZero(category.percent) > 0) checkTotal(`${category.id} 묶음 비중`, category.groupTotalPercent);
    const seen = new Set();
    groups.forEach((group) => {
      if (!Number.isFinite(Number(group.percent)) || Number(group.percent) < 0) issues.push(`${category.id} ${group.name}: 비중은 0 이상의 숫자로 입력해 주세요.`);
      if (numberOrZero(category.percent) > 0 && numberOrZero(group.percent) > 0) checkTotal(`${category.id} ${group.isDefault ? '종목' : group.name || '묶음'} 비중`, group.itemTotalPercent);
      group.items.forEach((item) => {
        const key = securityKey(item);
        if (!String(item.name || '').trim() && !String(item.ticker || '').trim()) issues.push(`${category.id}: 이름이나 티커가 없는 종목을 확인해 주세요.`);
        if (key && (seen.has(key) || item.isDuplicate)) issues.push(`${category.id}: ${item.name || item.ticker} 종목이 중복되어 있어요. 한 곳에 배분해 주세요.`);
        if (key) seen.add(key);
        if (!Number.isFinite(Number(item.percent)) || Number(item.percent) < 0 || Number(item.percent) > 100) issues.push(`${item.name || item.ticker || category.id}: 비중은 0부터 100 사이의 숫자로 입력해 주세요.`);
        if (!item.currency) issues.push(`${item.name || item.ticker || category.id}: 종목 정보에서 거래 통화를 선택해 주세요.`);
      });
    });
  });
  return [...new Set(issues)];
};

export const getTargetItemSnapshotKey = (targetPortfolio) => targetPortfolio.categories
  .flatMap(category => getTargetGroups(targetPortfolio, category.id).flatMap(group => (
    (group.items || []).map(item => `${category.id}:${group.id}:${item.id}:${item.ticker || ''}:${item.currency || ''}`)
  )))
  .join('|');
