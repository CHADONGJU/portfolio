const normalizeSearchText = (value) => String(value || '').trim().toLocaleLowerCase('ko');

export const buildStockSearchOptions = (records = []) => {
  const stocksByName = new Map();

  records.forEach((record) => {
    const name = String(record?.name || '').trim();
    if (!name) return;

    if (!stocksByName.has(name)) {
      stocksByName.set(name, new Set());
    }

    const ticker = String(record?.ticker || '').trim().toUpperCase();
    if (ticker) stocksByName.get(name).add(ticker);
  });

  return [...stocksByName.entries()]
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName, 'ko'))
    .map(([name, tickers]) => {
      const tickerList = [...tickers].sort();
      return {
        value: name,
        label: name,
        description: tickerList.join(' · '),
        keywords: tickerList,
      };
    });
};

export const filterStockSearchOptions = (options = [], query = '') => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return options;

  return options.filter((option) => normalizeSearchText([
    option?.label,
    option?.description,
    ...(Array.isArray(option?.keywords) ? option.keywords : []),
  ].join(' ')).includes(normalizedQuery));
};
