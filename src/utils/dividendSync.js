const getDividendIdentity = (dividend = {}) => [
  dividend.id || '',
  dividend.assetId || '',
  dividend.name || '',
  dividend.ticker || '',
  dividend.date || '',
  dividend.currency || '',
  dividend.quantity || '',
  dividend.perShareGrossAmount || '',
  dividend.grossAmount || '',
  dividend.amount || '',
].join('::');

export const mergeUniqueDividends = (primary = [], secondary = []) => {
  const seen = new Set();
  return [...primary, ...secondary].filter((dividend) => {
    const key = getDividendIdentity(dividend);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const mergeDividendResultsByAsset = (
  previousDividends = [],
  nextDividends = [],
  assets = [],
  refreshedAssetNames = null,
) => {
  const nextAssetNames = new Set(nextDividends.map((dividend) => dividend.name).filter(Boolean));
  const refreshedNames = new Set(
    (refreshedAssetNames ?? [...nextAssetNames]).filter(Boolean),
  );
  const activeAssetNames = new Set(assets.map((asset) => asset.name).filter(Boolean));
  const preserved = previousDividends.filter((dividend) => (
    activeAssetNames.has(dividend.name) && !refreshedNames.has(dividend.name)
  ));

  return mergeUniqueDividends(nextDividends, preserved)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
};

export const mergeDividendAssetRegistry = (previousRegistry = [], nextRegistry = [], assets = []) => {
  const activeAssetNames = new Set(assets.map((asset) => asset.name).filter(Boolean));
  const registryByName = new Map(
    previousRegistry
      .filter((entry) => activeAssetNames.has(entry.name))
      .map((entry) => [entry.name, entry]),
  );

  nextRegistry.forEach((entry) => {
    if (!entry.name || !activeAssetNames.has(entry.name)) return;
    const previous = registryByName.get(entry.name);

    if (entry.syncState === 'error') {
      registryByName.set(entry.name, {
        ...previous,
        assetId: entry.assetId,
        name: entry.name,
        ticker: entry.ticker,
        category: entry.category,
        currency: entry.currency,
        syncState: 'error',
        errorMessage: entry.errorMessage || '배당 데이터를 불러오지 못했습니다.',
        lastErrorAt: entry.lastErrorAt || new Date().toISOString(),
      });
      return;
    }

    registryByName.set(entry.name, {
      ...previous,
      ...entry,
      hasDividends: Boolean(entry.hasDividends),
      sourceDividendCount: Math.max(0, Number(entry.sourceDividendCount) || 0),
      earnedDividendCount: Math.max(0, Number(entry.earnedDividendCount) || 0),
      syncState: entry.syncState || 'success',
      errorMessage: '',
      lastErrorAt: '',
    });
  });

  return [...registryByName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const getEmptyDividendStatus = (registry = null) => {
  if (registry?.syncState === 'error') return '배당 갱신 실패';

  const sourceDividendCount = Math.max(0, Number(registry?.sourceDividendCount) || 0);
  const earnedDividendCount = Math.max(0, Number(registry?.earnedDividendCount) || 0);
  if (sourceDividendCount > 0 && earnedDividendCount === 0) {
    return `원본 ${sourceDividendCount}건 · 보유기간 해당 0건`;
  }
  if (registry?.syncState === 'empty') return '공개 배당 원본 없음';
  return '배당 조회 전';
};

export const getEmptyDividendMessage = (registry = null) => {
  if (registry?.syncState === 'error') {
    return registry.errorMessage || '배당 데이터를 갱신하지 못했습니다.';
  }

  const sourceDividendCount = Math.max(0, Number(registry?.sourceDividendCount) || 0);
  const earnedDividendCount = Math.max(0, Number(registry?.earnedDividendCount) || 0);
  if (sourceDividendCount > 0 && earnedDividendCount === 0) {
    return '공개 배당 이력은 확인됐지만 매수일 이후 배당락일에 보유한 수량이 없습니다.';
  }
  if (registry?.syncState === 'empty') return '공개 데이터 제공처에서 배당 이력을 찾지 못했습니다.';
  return '새로고침하면 공개 배당 이력과 배당락일 보유 수량을 확인합니다.';
};
