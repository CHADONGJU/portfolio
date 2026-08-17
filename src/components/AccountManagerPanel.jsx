import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from '../utils/formatters.js';

const todayKey = () => new Date().toISOString().slice(0, 10);

const emptyFlowForm = () => ({
  id: '',
  date: todayKey(),
  type: 'deposit',
  amount: '',
  currency: 'KRW',
  fxRate: '1',
  note: '',
});

const AccountManagerPanel = ({
  capitalFlows,
  exchangeRates,
  manualSnapshots,
  onClose,
  onDeleteFlow,
  onDeleteSnapshot,
  onSaveFlow,
  onSaveOpeningSnapshot,
}) => {
  const currentYear = new Date().getFullYear();
  const [flowForm, setFlowForm] = useState(emptyFlowForm);
  const [openingYear, setOpeningYear] = useState(String(currentYear));
  const [openingValue, setOpeningValue] = useState('');

  const sortedFlows = useMemo(() => (
    [...capitalFlows].sort((left, right) => String(right.date).localeCompare(String(left.date)))
  ), [capitalFlows]);
  const totals = useMemo(() => capitalFlows.reduce((summary, flow) => {
    const amount = Number(flow.amountKRW) || 0;
    if (flow.type === 'withdrawal') summary.withdrawal += amount;
    else summary.deposit += amount;
    return summary;
  }, { deposit: 0, withdrawal: 0 }), [capitalFlows]);

  const applyCurrency = (currency) => {
    const rate = currency === 'KRW' ? 1 : Number(exchangeRates[currency]) || 0;
    setFlowForm((previous) => ({ ...previous, currency, fxRate: rate ? String(rate) : '' }));
  };

  const submitFlow = (event) => {
    event.preventDefault();
    const amount = Number(flowForm.amount);
    const fxRate = flowForm.currency === 'KRW' ? 1 : Number(flowForm.fxRate);
    if (!(amount > 0) || !(fxRate > 0) || !flowForm.date) return;
    onSaveFlow({
      ...flowForm,
      amount,
      fxRate,
      amountKRW: amount * fxRate,
    });
    setFlowForm(emptyFlowForm());
  };

  const editFlow = (flow) => {
    setFlowForm({
      id: flow.id,
      date: flow.date,
      type: flow.type,
      amount: String(flow.amount || ''),
      currency: flow.currency || 'KRW',
      fxRate: String(flow.fxRate || (flow.currency === 'KRW' ? 1 : '')),
      note: flow.note || '',
    });
  };

  return (
    <div className="w-full md:max-w-3xl max-h-[92dvh] bg-surface rounded-t-[28px] md:rounded-[28px] overflow-hidden flex flex-col shadow-2xl">
      <div className="p-5 md:p-7 border-b border-line flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-ink text-surface grid place-items-center"><UserRound size={20} /></div>
          <div>
            <h2 id="account-manager-title" className="text-lg md:text-xl font-bold text-ink">계좌 관리</h2>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">입출금과 연초 평가액은 연도별 수익률 계산에만 사용됩니다.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="계좌 관리 닫기" className="w-10 h-10 rounded-xl bg-canvas text-ink-mute grid place-items-center hover:text-ink"><X size={18} /></button>
      </div>

      <div className="overflow-y-auto scroll-soft p-5 md:p-7 space-y-7">
        <section>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-canvas rounded-2xl p-4">
              <p className="text-[11px] font-bold text-ink-mute">누적 입금</p>
              <p className="figure text-lg font-bold text-ink mt-1">{formatMoney(totals.deposit, 'KRW')}</p>
            </div>
            <div className="bg-canvas rounded-2xl p-4">
              <p className="text-[11px] font-bold text-ink-mute">누적 출금</p>
              <p className="figure text-lg font-bold text-ink mt-1">{formatMoney(totals.withdrawal, 'KRW')}</p>
            </div>
          </div>

          <form onSubmit={submitFlow} className="rounded-2xl border border-line p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm md:text-base font-bold text-ink">{flowForm.id ? '입출금 기록 수정' : '입출금 기록 추가'}</h3>
              {flowForm.id && <button type="button" onClick={() => setFlowForm(emptyFlowForm())} className="text-xs font-bold text-ink-mute hover:text-ink">수정 취소</button>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <select value={flowForm.type} onChange={(event) => setFlowForm((previous) => ({ ...previous, type: event.target.value }))} className="h-12 px-3 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand">
                <option value="deposit">입금</option>
                <option value="withdrawal">출금</option>
              </select>
              <input type="date" value={flowForm.date} onChange={(event) => setFlowForm((previous) => ({ ...previous, date: event.target.value }))} className="h-12 px-3 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
              <select value={flowForm.currency} onChange={(event) => applyCurrency(event.target.value)} className="h-12 px-3 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand">
                <option value="KRW">원화</option>
                <option value="USD">달러</option>
                <option value="JPY">엔화</option>
              </select>
              <input inputMode="decimal" value={formatInputNumber(flowForm.amount)} onChange={(event) => setFlowForm((previous) => ({ ...previous, amount: sanitizeNumericInput(event.target.value) }))} placeholder="금액" className="h-12 px-3 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div className={`grid grid-cols-1 gap-2.5 ${flowForm.currency === 'KRW' ? 'md:grid-cols-[1fr_auto]' : 'md:grid-cols-[180px_1fr_auto]'}`}>
              {flowForm.currency !== 'KRW' && (
                <input inputMode="decimal" value={formatInputNumber(flowForm.fxRate)} onChange={(event) => setFlowForm((previous) => ({ ...previous, fxRate: sanitizeNumericInput(event.target.value) }))} placeholder="적용 환율" className="h-12 px-3 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
              )}
              <input value={flowForm.note} onChange={(event) => setFlowForm((previous) => ({ ...previous, note: event.target.value }))} placeholder="메모 (선택)" className="h-12 px-3 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
              <button type="submit" className="h-12 px-5 bg-ink text-surface rounded-xl text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-90"><Plus size={15} /> {flowForm.id ? '저장' : '추가'}</button>
            </div>
          </form>

          <div className="mt-3 space-y-2 max-h-64 overflow-y-auto scroll-soft">
            {sortedFlows.map((flow) => (
              <div key={flow.id} className="rounded-xl bg-canvas px-4 py-3 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl grid place-items-center ${flow.type === 'withdrawal' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>
                  {flow.type === 'withdrawal' ? <ArrowUpFromLine size={16} /> : <ArrowDownToLine size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-sm font-bold text-ink">{flow.date} · {flow.type === 'withdrawal' ? '출금' : '입금'} {formatMoney(flow.amount, flow.currency)}</p>
                  <p className="text-[11px] font-semibold text-ink-mute mt-0.5 truncate">원화 기준 {formatMoney(flow.amountKRW, 'KRW')}{flow.note ? ` · ${flow.note}` : ''}</p>
                </div>
                <button type="button" onClick={() => editFlow(flow)} aria-label="입출금 기록 수정" className="w-9 h-9 rounded-xl text-ink-mute hover:bg-surface hover:text-ink grid place-items-center"><Pencil size={14} /></button>
                <button type="button" onClick={() => onDeleteFlow(flow.id)} aria-label="입출금 기록 삭제" className="w-9 h-9 rounded-xl text-ink-mute hover:bg-down-soft hover:text-down grid place-items-center"><Trash2 size={14} /></button>
              </div>
            ))}
            {sortedFlows.length === 0 && <p className="py-5 text-center text-xs font-bold text-ink-mute">등록된 입출금 기록이 없습니다.</p>}
          </div>
        </section>

        <section className="border-t border-line pt-6">
          <h3 className="text-sm md:text-base font-bold text-ink">연초 평가액</h3>
          <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">과거 연도는 1월 1일 기준 평가액이 있어야 연간 수익률을 시작할 수 있습니다.</p>
          <form onSubmit={(event) => { event.preventDefault(); if (openingValue !== '' && Number(openingValue) >= 0) { onSaveOpeningSnapshot(Number(openingYear), Number(openingValue)); setOpeningValue(''); } }} className="mt-3 grid grid-cols-[110px_1fr_auto] gap-2.5">
            <input inputMode="numeric" value={openingYear} onChange={(event) => setOpeningYear(event.target.value.replace(/\D/g, '').slice(0, 4))} className="h-12 px-3 bg-canvas rounded-xl text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
            <input inputMode="decimal" value={formatInputNumber(openingValue)} onChange={(event) => setOpeningValue(sanitizeNumericInput(event.target.value))} placeholder="1월 1일 평가액" className="h-12 px-3 bg-canvas rounded-xl text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
            <button type="submit" className="h-12 px-4 bg-line-soft text-ink rounded-xl text-sm font-bold hover:bg-line">저장</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {manualSnapshots.map((snapshot) => (
              <span key={snapshot.id} className="inline-flex items-center gap-2 bg-canvas rounded-xl px-3 py-2 text-xs font-bold text-ink-soft">
                {snapshot.date.slice(0, 4)}년 {formatMoney(snapshot.valueKRW, 'KRW')}
                <button type="button" onClick={() => onDeleteSnapshot(snapshot.id)} aria-label="연초 평가액 삭제" className="text-ink-mute hover:text-down"><X size={13} /></button>
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AccountManagerPanel;
