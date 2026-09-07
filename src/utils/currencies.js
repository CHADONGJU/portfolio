export const PORTFOLIO_CURRENCIES = [
  { value: 'KRW', label: '원화 (KRW)' },
  { value: 'USD', label: '미국 달러 (USD)' },
  { value: 'JPY', label: '일본 엔 (JPY)' },
];

export const resolveManualTradeAsset = (form, assets) => {
  const ticker = String(form.ticker || '').trim().toUpperCase();
  const name = String(form.stockName || form.name || '').trim();
  return assets.find((asset) => ticker
    ? String(asset.ticker || '').trim().toUpperCase() === ticker
    : asset.name === name);
};
