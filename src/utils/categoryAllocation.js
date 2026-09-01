const parseValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

/**
 * 소수점 첫째 자리로 표시한 비중까지 정확히 100.0%가 되도록 최대 나머지 방식으로
 * 0.1%p 단위를 배분한다. 각각을 따로 반올림하면 99.9%나 100.1%가 될 수 있다.
 */
export const distributePercentTenths = (values = []) => {
  const safeValues = values.map(parseValue);
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return safeValues.map(() => 0);

  const exactUnits = safeValues.map((value) => (value / total) * 1000);
  const units = exactUnits.map(Math.floor);
  let remaining = 1000 - units.reduce((sum, value) => sum + value, 0);

  exactUnits
    .map((value, index) => ({ index, remainder: value - units[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach(({ index }) => {
      if (remaining <= 0) return;
      units[index] += 1;
      remaining -= 1;
    });

  return units.map((value) => value / 10);
};

/**
 * 현재 비중은 목표 예산이 아니라 현재 보유 자산 전체를 분모로 삼는다.
 * 목표에 없지만 실제로 보유한 카테고리도 목표 0% 행으로 포함한다.
 */
export const buildCategoryAllocationRows = ({ assets = [], targetCategories = [] } = {}) => {
  const currentValueByCategory = new Map();
  assets.forEach((asset) => {
    const category = String(asset?.category || '미분류').trim() || '미분류';
    currentValueByCategory.set(
      category,
      (currentValueByCategory.get(category) || 0) + parseValue(asset?.currentKRW),
    );
  });

  const targetByCategory = new Map();
  const categoryIds = [];
  targetCategories.forEach((category) => {
    const id = String(category?.id || '').trim();
    if (!id || targetByCategory.has(id)) return;
    targetByCategory.set(id, category);
    categoryIds.push(id);
  });
  currentValueByCategory.forEach((value, id) => {
    if (value > 0 && !targetByCategory.has(id)) categoryIds.push(id);
  });

  const values = categoryIds.map((id) => currentValueByCategory.get(id) || 0);
  const currentPercents = distributePercentTenths(values);

  return categoryIds.map((id, index) => ({
    id,
    currentValue: values[index],
    currentPercent: currentPercents[index],
    targetPercent: Number(targetByCategory.get(id)?.percent) || 0,
    hasTarget: targetByCategory.has(id),
  }));
};
