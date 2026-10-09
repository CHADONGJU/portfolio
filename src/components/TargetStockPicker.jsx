import { useEffect, useId, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import ModalOverlay from './ModalOverlay.jsx';
import { getTargetItemCurrency, normalizeInputTicker } from '../utils/currencies.js';
import { formatMoney } from '../utils/formatters.js';
import { getSearchStockCurrency, isTargetStockAlreadyAdded, searchTargetStocks } from '../services/stockSearch.js';

const CURRENCIES = [
  ['KRW', '원화'], ['USD', '미국 달러'], ['JPY', '일본 엔'], ['HKD', '홍콩 달러'],
  ['GBP', '영국 파운드'], ['EUR', '유로'], ['CAD', '캐나다 달러'], ['AUD', '호주 달러'],
  ['CHF', '스위스 프랑'], ['CNY', '중국 위안'], ['SGD', '싱가포르 달러'],
  ['TWD', '대만 달러'], ['INR', '인도 루피'],
];
const FIELD_CLASS = 'w-full min-h-11 rounded-xl bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-brand';

const TargetStockPicker = ({ categoryId, holdings = [], existingItems = [], onSelect, onClose }) => {
  const fieldId = useId();
  const [mode, setMode] = useState('holdings');
  const [holdingQuery, setHoldingQuery] = useState('');
  const [marketQuery, setMarketQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const [searchError, setSearchError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ name: '', ticker: '', currency: getTargetItemCurrency(categoryId) });
  const [manualError, setManualError] = useState('');
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current += 1; }, []);

  const isAdded = (asset) => isTargetStockAlreadyAdded(asset, existingItems, categoryId);
  const availableHoldings = holdings.filter((asset) => !isAdded(asset));
  const normalizedQuery = holdingQuery.trim().toLocaleLowerCase('ko');
  const visibleHoldings = availableHoldings.filter((asset) => (
    `${asset.name} ${asset.ticker}`.toLocaleLowerCase('ko').includes(normalizedQuery)
  ));
  const availableResults = results.filter((asset) => !isAdded(asset));

  const selectAsset = (asset) => {
    if (isAdded(asset)) return;
    if (!asset.currency) {
      setManual({ name: asset.name, ticker: asset.ticker, currency: '' });
      setShowManual(true);
      setManualError('이 종목의 거래 통화를 선택한 뒤 추가해 주세요.');
      return;
    }
    onSelect(asset);
  };

  const searchMarket = async (event) => {
    event.preventDefault();
    const term = marketQuery.trim();
    if (!term) return;
    const activeRequest = ++requestId.current;
    setSearchState('loading');
    setSearchError('');
    setResults([]);
    try {
      const found = await searchTargetStocks(term, categoryId);
      if (activeRequest !== requestId.current) return;
      setResults(found);
      setSearchState('done');
    } catch (error) {
      if (activeRequest !== requestId.current) return;
      setSearchError(error.message || '검색할 수 없어요. 다시 시도하거나 직접 입력해 주세요.');
      setSearchState('error');
    }
  };

  const addManual = (event) => {
    event.preventDefault();
    const name = manual.name.trim();
    const rawTicker = normalizeInputTicker(manual.ticker);
    const ticker = categoryId === '국내주식' ? rawTicker.replace(/\.(KS|KQ)$/, '') : rawTicker;
    if (!name || !ticker) {
      setManualError('종목명과 종목 코드를 모두 입력해 주세요.');
      return;
    }
    if (categoryId === '국내주식' && !/^\d{6}$/.test(ticker)) {
      setManualError('국내주식의 종목 코드는 숫자 6자리로 입력해 주세요.');
      return;
    }
    if (categoryId === '해외주식' && /^\d{6}(\.(KS|KQ))?$/.test(ticker)) {
      setManualError('국내 종목은 국내주식에서 추가해 주세요.');
      return;
    }
    if (!/^[A-Z0-9][A-Z0-9.^=-]*$/.test(ticker)) {
      setManualError('종목 코드를 확인해 주세요. 예: AAPL, 7203.T');
      return;
    }
    const currency = categoryId === '국내주식' ? 'KRW' : getTargetItemCurrency(categoryId, ticker, manual.currency);
    if (!currency) {
      setManualError('종목의 거래 통화를 선택해 주세요.');
      return;
    }
    const asset = { name, ticker, currency };
    if (isAdded(asset)) {
      setManualError('이 종목은 이미 목표에 있어요. 기존 종목의 비중을 조정해 주세요.');
      return;
    }
    onSelect(asset);
  };

  const renderOption = (asset, held = false) => (
    <li key={asset.id || asset.ticker}>
      <button type="button" onClick={() => selectAsset(asset)} className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-3 text-left transition-colors hover:border-brand hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-brand">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-bold text-ink">{asset.name}</span>
          <span className="mt-1 block text-xs text-ink-mute">{asset.ticker || '종목 코드 없음'} · {asset.currency || '통화 확인 필요'}{asset.exchange ? ` · ${asset.exchange}` : ''}</span>
          {held && <span className="mt-1 block text-xs text-ink-soft">현재 보유액 {formatMoney(asset.currentKRW, 'KRW')}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-brand"><Plus size={15} aria-hidden="true" />선택</span>
      </button>
    </li>
  );

  return (
    <ModalOverlay onClose={onClose} labelledBy={`${fieldId}-title`} overlayClassName="z-[120]">
      <div className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-modal scroll-soft md:rounded-3xl md:p-7">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id={`${fieldId}-title`} className="text-lg font-bold text-ink">목표 종목 추가</h3>
          <button type="button" onClick={onClose} aria-label="목표 종목 추가 닫기" className="rounded-full bg-canvas p-3 text-ink-soft hover:bg-line-soft"><X size={18} /></button>
        </div>
        <p className="mb-5 text-sm text-ink-soft">{categoryId}에 담을 종목을 선택해 주세요. 비중은 추가한 뒤 정할 수 있어요.</p>
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1" aria-label="종목 선택 방법">
          {[
            ['holdings', '보유 종목에서 선택'], ['market', '새 종목 검색'],
          ].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`min-h-11 rounded-lg px-2 py-2 text-xs font-bold sm:text-sm ${mode === value ? 'bg-surface text-brand shadow-sm' : 'text-ink-mute hover:text-ink'}`}>{label}</button>
          ))}
        </div>

        {mode === 'holdings' ? (
          <div>
            <label className="mb-2 block text-xs font-bold text-ink-soft" htmlFor={`${fieldId}-holdings`}>보유 종목명 또는 코드</label>
            <input id={`${fieldId}-holdings`} className={FIELD_CLASS} type="search" value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} placeholder="보유 종목 찾기" autoComplete="off" />
            <ul className="mt-3 space-y-2">{visibleHoldings.map((asset) => renderOption(asset, true))}</ul>
            {visibleHoldings.length === 0 && (
              <p role="status" className="rounded-xl py-7 text-center text-sm text-ink-mute">
                {holdings.length === 0 ? `${categoryId} 보유 종목이 없어요. 새 종목을 검색해 보세요.` : availableHoldings.length === 0 ? '보유 종목이 모두 목표에 추가되어 있어요.' : '이름이나 코드가 일치하는 보유 종목이 없어요.'}
              </p>
            )}
            {holdings.length > availableHoldings.length && <p className="mt-3 flex items-center gap-1 text-xs text-ink-mute"><Check size={13} aria-hidden="true" />이미 목표에 담은 종목은 제외했어요.</p>}
          </div>
        ) : (
          <div>
            <form onSubmit={searchMarket}>
              <label className="mb-2 block text-xs font-bold text-ink-soft" htmlFor={`${fieldId}-market`}>종목명 또는 코드 검색</label>
              <div className="flex items-center gap-2">
                <input id={`${fieldId}-market`} className={`${FIELD_CLASS} min-w-0 flex-1`} type="search" value={marketQuery} onChange={(event) => { requestId.current += 1; setMarketQuery(event.target.value); setSearchState('idle'); setResults([]); setSearchError(''); }} placeholder={categoryId === '국내주식' ? '예: 005930 또는 Samsung' : '예: Apple 또는 AAPL'} maxLength={80} autoComplete="off" />
                <button type="submit" disabled={!marketQuery.trim() || searchState === 'loading'} className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50"><Search size={15} aria-hidden="true" />검색</button>
              </div>
            </form>
            <p className="mt-2 text-xs leading-relaxed text-ink-mute">{categoryId}의 주식·ETF를 검색해요. 결과가 없으면 종목 코드나 영문명으로 검색해 주세요.</p>
            <div role="status" aria-live="polite" className="mt-3 text-sm text-ink-soft">
              {searchState === 'loading' && <p className="py-4">종목을 검색하고 있어요…</p>}
              {searchState === 'error' && <p className="rounded-xl bg-canvas p-3">{searchError}</p>}
              {searchState === 'done' && availableResults.length === 0 && <p className="py-4">{results.length > 0 ? '검색된 종목이 이미 목표에 추가되어 있어요.' : '검색 결과가 없어요. 검색어를 바꾸거나 아래에서 직접 입력해 주세요.'}</p>}
            </div>
            <ul className="mt-3 space-y-2">{availableResults.map((asset) => renderOption(asset))}</ul>
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <button type="button" className="min-h-11 text-sm font-bold text-brand" aria-expanded={showManual} aria-controls={`${fieldId}-manual`} onClick={() => { setShowManual(!showManual); setManualError(''); }}>{showManual ? '직접 입력 닫기' : '찾는 종목이 없나요? 직접 입력하기'}</button>
          {showManual && (
            <form id={`${fieldId}-manual`} onSubmit={addManual} className="mt-3 space-y-3">
              <div>
                <label htmlFor={`${fieldId}-name`} className="mb-1.5 block text-xs font-bold text-ink-soft">종목명</label>
                <input id={`${fieldId}-name`} className={FIELD_CLASS} value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} maxLength={100} required />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${fieldId}-ticker`} className="mb-1.5 block text-xs font-bold text-ink-soft">종목 코드 (티커)</label>
                  <input id={`${fieldId}-ticker`} className={FIELD_CLASS} value={manual.ticker} onChange={(event) => { const ticker = event.target.value; setManual({ ...manual, ticker, currency: getSearchStockCurrency(categoryId, normalizeInputTicker(ticker)) }); }} placeholder={categoryId === '국내주식' ? '005930' : 'AAPL, 7203.T'} maxLength={30} required autoCapitalize="characters" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor={`${fieldId}-currency`} className="mb-1.5 block text-xs font-bold text-ink-soft">거래 통화</label>
                  <select id={`${fieldId}-currency`} className={FIELD_CLASS} value={manual.currency} disabled={categoryId === '국내주식'} onChange={(event) => setManual({ ...manual, currency: getTargetItemCurrency(categoryId, manual.ticker, event.target.value) })} required>
                    <option value="">통화 선택</option>
                    {CURRENCIES.map(([value, label]) => <option key={value} value={value}>{label} ({value})</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-mute">직접 입력한 종목의 현재가는 추가 후 확인해 주세요. 보유 종목과 종목 코드가 같으면 보유 정보가 연결돼요.</p>
              {manualError && <p role="alert" className="text-sm font-bold text-danger">{manualError}</p>}
              <button type="submit" className="min-h-11 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white">이 종목 추가</button>
            </form>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};

export default TargetStockPicker;
