// 목표 포트폴리오 탭의 상태·파생값·편집 동작을 한곳에 모은 훅.
//
// 목표 비중은 분류(국내주식/해외주식) → 그룹(폴더) → 종목 3단계이고, 화면은
// 그 계획과 현재 보유를 나란히 비교한다. "목표까지 얼마를 더 사야 하는가"를
// 계산하는 targetPortfolioGuide가 핵심이고, 나머지 차트 데이터는 그 결과를
// 도넛 조각으로 바꾼 것이다.
//
// 저장되는 값(targetPortfolio)은 App이 클라우드 동기화와 함께 들고 있고,
// 이 훅은 그것을 읽고 setTargetPortfolio로 고치기만 한다. 화면에서만 쓰는
// 선택 상태(어느 분류를 펼쳤는지 등)는 여기서 직접 소유한다.
import { useMemo, useState } from 'react';
import { getCategoryColor, getCategoryDetailColor, isPortfolioAssetCategory } from '../constants.js';
import { getTargetItemCurrency } from '../utils/currencies.js';
import {
  buildTargetPortfolioFromHoldings, buildTargetPortfolioGuide, getTargetBudgetKRW,
  getTargetGroups, normalizeTargetPercents,
} from '../utils/targetPortfolio.js';
import { sanitizeNumericInput } from '../utils/formatters.js';
import { getSearchStockCurrency } from '../services/stockSearch.js';

// 도넛 조각은 앞 조각들의 비중 합계 지점에서 시작한다. 누적값을 map 안에서
// 굴리면 "렌더 중 변수 재할당"이 되어 React 규칙에 걸리므로, 훅 바깥의 순수
// 함수로 빼 둔다. getPercent가 조각 크기를, build가 조각 모양을 정한다.
const withRunningPercent = (items, getPercent, build) => {
  let cumulativePercent = 0;

  return items.map((item, index) => {
    const percent = getPercent(item, index);
    const startPercent = cumulativePercent;
    cumulativePercent += percent;
    return build(item, { percent, startPercent, index });
  });
};

export const useTargetPortfolio = ({
  targetPortfolio,
  setTargetPortfolio,
  enhancedAssets,
  totalConvertedKRW,
  exchangeRate,
  jpyKrwRate,
  currencyRates,
}) => {
  // 화면에서만 쓰는 선택 상태. 저장하지 않는다.
  const [targetViewMode, setTargetViewMode] = useState('table');
  const [pickedTargetCategory, setSelectedTargetCategory] = useState(null);
  const [pickedTargetGroup, setSelectedTargetGroup] = useState(null);
  const [targetCategoryDraft, setTargetCategoryDraft] = useState('국내주식');

  const targetBudgetKRW = getTargetBudgetKRW(targetPortfolio, totalConvertedKRW);
  const targetCategoryTotalPercent = targetPortfolio.categories.reduce((sum, category) => sum + (Number(category.percent) || 0), 0);
  const targetPortfolioGuide = useMemo(() => buildTargetPortfolioGuide({
    targetPortfolio, enhancedAssets, totalConvertedKRW, exchangeRate, jpyKrwRate, currencyRates,
  }), [targetPortfolio, enhancedAssets, totalConvertedKRW, exchangeRate, jpyKrwRate, currencyRates]);
  const targetCurrentChartData = useMemo(() => {
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

    return withRunningPercent(
      grouped,
      (category) => (totalConvertedKRW > 0 ? (category.value / totalConvertedKRW) * 100 : 0),
      (category, { percent, startPercent }) => ({
        id: category.id,
        name: category.name,
        value: category.value,
        percent,
        startPercent,
        color: getCategoryColor(category.name),
      }),
    );
  }, [enhancedAssets, totalConvertedKRW]);
  const targetGoalChartData = useMemo(() => {
    return withRunningPercent(
      targetPortfolioGuide,
      (category) => Number(category.percent) || 0,
      (category, { percent, startPercent }) => ({
        id: `goal-${category.id}`,
        name: category.id,
        value: category.targetValue,
        percent,
        startPercent,
        color: getCategoryColor(category.id),
      }),
    );
  }, [targetPortfolioGuide]);
  /**
   * 고른 분류·폴더가 목록에서 사라지면(삭제·초기화 등) 선택이 없는 것으로 본다.
   * 예전에는 effect로 setState해 되돌렸는데, 그러면 되돌리기 전 한 프레임 동안
   * 사라진 항목이 선택된 채로 그려지고 렌더가 한 번 더 돈다.
   */
  const selectedTargetCategory = pickedTargetCategory
    && targetPortfolio.categories.some((category) => category.id === pickedTargetCategory)
    ? pickedTargetCategory
    : null;

  const selectedTargetGuide = useMemo(() => (
    targetPortfolioGuide.find(category => category.id === selectedTargetCategory) || null
  ), [targetPortfolioGuide, selectedTargetCategory]);
  const selectedTargetGroup = pickedTargetGroup
    && selectedTargetGuide?.groups.some((group) => group.id === pickedTargetGroup)
    ? pickedTargetGroup
    : null;

  const selectedTargetGroupGuide = useMemo(() => {
    if (!selectedTargetGuide || !selectedTargetGroup) return null;
    return selectedTargetGuide.groups.find(group => group.id === selectedTargetGroup) || null;
  }, [selectedTargetGuide, selectedTargetGroup]);
  const targetDrilldownChartData = useMemo(() => {
    if (!selectedTargetGuide) return targetGoalChartData;

    let cumulativePercent = 0;
    if (selectedTargetGroupGuide) {
      const items = selectedTargetGroupGuide.items.length > 0
        ? [...selectedTargetGroupGuide.items]
        : [{ id: `${selectedTargetGroupGuide.id}-empty`, name: '종목 없음', targetValue: selectedTargetGroupGuide.targetValue, percent: 100 }];
      const itemTotalPercent = items.reduce((sum, item) => sum + (Number(item.percent) || 0), 0);
      if (itemTotalPercent < 100) items.push({
        id: `${selectedTargetGroupGuide.id}-unallocated`, name: '아직 배분하지 않음',
        targetValue: selectedTargetGroupGuide.targetValue * (100 - itemTotalPercent) / 100,
        percent: 100 - itemTotalPercent,
      });

      return items.map((item, index) => {
        const percent = Number(item.percent) || 0;
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
  const normalizeCategoryPercents = () => {
    setTargetPortfolio((prev) => {
      const scaled = normalizeTargetPercents(prev.categories);
      return {
        ...prev,
        categories: prev.categories.map((category, index) => ({ ...category, percent: scaled[index] })),
      };
    });
  };

  const normalizeGroupPercents = (categoryId) => {
    setTargetPortfolio((prev) => {
      const groups = getTargetGroups(prev, categoryId);
      const scaled = normalizeTargetPercents(groups);
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
      const scaled = normalizeTargetPercents(items);
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
    setTargetPortfolio(prev => {
      const groups = getTargetGroups(prev, categoryId);
      return {
        ...prev,
        groups: {
          ...prev.groups,
          [categoryId]: [
            ...groups,
            { id: `${Date.now()}-${Math.random()}`, name: '새 묶음', allocationMode: 'percent', percent: groups.length ? 0 : 100, items: [] },
          ],
        },
      };
    });
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
      // 삭제한 마지막 묶음 대신 오래된 flat items가 다시 나타나지 않게 한다.
      items: { ...prev.items, [categoryId]: [] },
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).filter(group => group.id !== groupId),
      },
    }));
  };

  const addTargetItem = (categoryId, groupId = null, asset = null) => {
    setTargetPortfolio(prev => {
      const groups = getTargetGroups(prev, categoryId);
      const targetGroupId = groupId || groups.find((group) => group.isDefault)?.id || groups[0]?.id || `${categoryId}-default-group`;
      if (!groups.length) groups.push({
        id: targetGroupId, name: '직접 설정', percent: 100, isDefault: true, allocationMode: 'percent', items: [],
      });
      return {
        ...prev,
        setupStarted: true,
        groups: {
          ...prev.groups,
          [categoryId]: groups.map(group => group.id === targetGroupId ? {
            ...group,
            items: [...group.items, {
              id: `${Date.now()}-${Math.random()}`, name: asset?.name || '', ticker: asset?.ticker || '', percent: 0,
              price: '', nativePrice: asset?.nativeCurrentPrice || '',
              currency: getTargetItemCurrency(categoryId, asset?.ticker, asset?.currency),
            }],
          } : group),
        },
      };
    });
  };

  const startTargetFromHoldings = () => {
    setTargetPortfolio((prev) => buildTargetPortfolioFromHoldings(prev, enhancedAssets));
    setSelectedTargetCategory(null);
    setSelectedTargetGroup(null);
  };

  const startTargetManually = () => {
    setTargetPortfolio((prev) => ({
      ...prev, setupStarted: true,
      budgetMode: prev.budgetMode || (prev.budget ? 'custom' : 'current'),
      categories: prev.categories?.length ? prev.categories : [{ id: '국내주식', percent: 0 }, { id: '해외주식', percent: 0 }],
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
                item.id === itemId ? {
                  ...item,
                  ...(patch.ticker !== undefined && patch.ticker !== item.ticker ? {
                    price: '', nativePrice: '', priceSource: '', priceUpdatedAt: '',
                    currency: getSearchStockCurrency(categoryId, patch.ticker),
                  } : {}),
                  ...patch,
                } : item
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
      items: { ...prev.items, [categoryId]: [] },
      groups: {
        ...prev.groups,
        [categoryId]: getTargetGroups(prev, categoryId).map(group => (
          group.id === groupId
            ? { ...group, items: (group.items || []).filter(item => item.id !== itemId) }
            : group
        )).filter(group => !group.isDefault || group.items.length > 0),
      },
    }));
  };

  return {
    targetViewMode,
    setTargetViewMode,
    selectedTargetCategory,
    setSelectedTargetCategory,
    selectedTargetGroup,
    setSelectedTargetGroup,
    targetCategoryDraft,
    setTargetCategoryDraft,
    targetBudgetKRW,
    targetCategoryTotalPercent,
    targetPortfolioGuide,
    selectedTargetGuide,
    selectedTargetGroupGuide,
    targetGoalChartData,
    targetCurrentChartData,
    targetDrilldownChartData,
    targetCurrentDrilldownChartData,
    addTargetCategory,
    removeTargetCategory,
    updateTargetCategoryPercent,
    normalizeCategoryPercents,
    addTargetGroup,
    removeTargetGroup,
    updateTargetGroup,
    normalizeGroupPercents,
    addTargetItem,
    removeTargetItem,
    updateTargetItem,
    normalizeItemPercents,
    startTargetFromHoldings,
    startTargetManually,
  };
};
