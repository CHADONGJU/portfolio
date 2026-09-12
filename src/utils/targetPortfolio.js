// 목표 포트폴리오(분류 → 그룹 → 종목 3단계)의 저장 형태를 읽는 helper.
// 그룹 개념이 없던 시절의 저장본(items만 있고 groups가 없는 형태)도 그대로
// 열리도록, 읽을 때 "직접 설정" 그룹 하나로 감싸 준다.
export const DEFAULT_TARGET_PORTFOLIO = {
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

export const getTargetGroups = (targetPortfolio, categoryId) => {
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

export const getTargetItemSnapshotKey = (targetPortfolio) => targetPortfolio.categories
  .flatMap(category => getTargetGroups(targetPortfolio, category.id).flatMap(group => (
    (group.items || []).map(item => `${category.id}:${group.id}:${item.id}:${item.ticker || ''}`)
  )))
  .join('|');
