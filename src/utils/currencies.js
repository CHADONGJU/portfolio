// 통화 목록과 "이 종목은 어느 통화로 체결되는가" 판정.
// 해외주식은 사용자가 통화 칸에서 무엇을 고르든 티커로 통화가 결정된다
// (4자리 숫자 티커면 일본 엔, 그 밖의 해외 종목은 달러).
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

export const normalizeInputTicker = (ticker = '') => String(ticker)
  .toUpperCase()
  .trim()
  .replace(/^TYO:/, '')
  .replace(/^TSE:/, '')
  .replace(/^JP:/, '')
  .replace(/\.JP$/, '.T')
  .replace(/\.TYO$/, '.T')
  .replace(/\s+/g, '');

export const isJapaneseTicker = (ticker = '') => /^\d{4}(\.T)?$/.test(normalizeInputTicker(ticker));

export const getTargetItemCurrency = (categoryId, ticker = '', savedCurrency = '') => {
  if (categoryId === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (savedCurrency && savedCurrency !== 'USD') return savedCurrency;
  if (normalizeInputTicker(ticker).includes('.')) return savedCurrency || '';
  return categoryId === '해외주식' ? 'USD' : 'KRW';
};


export const getAssetInputCurrency = (category, ticker = '', savedCurrency = '') => {
  if (category === '해외주식' && isJapaneseTicker(ticker)) return 'JPY';
  if (category === '해외주식' && normalizeInputTicker(ticker).includes('.') && savedCurrency) return savedCurrency;
  if (category === '해외주식') return 'USD';
  return 'KRW';
};
