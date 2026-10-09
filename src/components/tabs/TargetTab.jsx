import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus, Target, Trash2, Undo2 } from 'lucide-react';
import AnnualReturnGoalCard from '../AnnualReturnGoalCard.jsx';
import AnnualReturnHistory from '../AnnualReturnHistory.jsx';
import TargetPortfolioCharts from '../TargetPortfolioCharts.jsx';
import TargetStockPicker from '../TargetStockPicker.jsx';
import TargetAllocationEditor from '../TargetAllocationEditor.jsx';
import { PORTFOLIO_ASSET_CATEGORIES } from '../../constants.js';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from '../../utils/formatters.js';
import { getTargetHoldingOptions, getTargetPlanIssues } from '../../utils/targetPortfolio.js';

const primary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-canvas px-4 py-2.5 text-sm font-bold text-ink-soft hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-40';
const inputClass = 'w-full min-w-0 rounded-xl bg-canvas px-4 py-3 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand';
const pct = (value) => Number(Number(value || 0).toFixed(2)).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const complete = (value) => Math.abs(Number(value) - 100) < 0.001;

function PercentField({ label, value, onChange, ariaLabel }) {
  return <label className="block min-w-0 space-y-2"><span className="block text-xs font-semibold text-ink-soft">{label}</span><span className="relative block">
    <input aria-label={ariaLabel || label} inputMode="decimal" value={typeof value === 'number' ? Number(value.toFixed(4)) : value} onChange={(event) => onChange(sanitizeNumericInput(event.target.value))} className={`${inputClass} pr-10`} />
    <span className="pointer-events-none absolute right-4 top-3 text-sm text-ink-mute">%</span>
  </span></label>;
}

function AllocationStatus({ total, onNormalize, label }) {
  const remaining = 100 - total;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
    <p aria-live="polite" className={`text-sm font-semibold ${complete(total) ? 'text-ink-soft' : 'text-warn'}`}>
      {complete(total) ? `${label} 100% 배분 완료` : remaining > 0 ? `${label} ${pct(total)}% 배분 · 나머지 ${pct(remaining)}%를 배분해 주세요.` : `${label} ${pct(-remaining)}% 초과 · 비중을 줄여 주세요.`}
    </p>
    {!complete(total) && onNormalize && <button type="button" onClick={onNormalize} className="text-xs font-bold text-brand-strong underline underline-offset-4">{total > 0 ? '입력한 비율대로 100% 맞추기' : '똑같이 나누기'}</button>}
  </div>;
}

function AllocationComparison({ category }) {
  return <div className="space-y-3 rounded-2xl bg-canvas p-4 md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">{category.id}</h4><span className="text-xs text-ink-soft">현재 총자산 기준 {pct(category.currentPercent)}%</span></div>
    {[{ label: '현재', value: category.currentPercent, color: 'bg-ink-mute' }, { label: '목표', value: category.percent, color: 'bg-brand' }].map((row) => <div key={row.label} className="flex items-center gap-3 text-xs"><span className="w-6 shrink-0 text-ink-soft">{row.label}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${row.color}`} style={{ width: `${Math.max(0, Math.min(100, Number(row.value) || 0))}%` }} /></div><span className="w-14 text-right font-bold">{pct(row.value)}%</span></div>)}
    <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm"><div><p className="mb-1 text-xs text-ink-mute">목표 금액</p><p className="font-bold">{formatMoney(category.targetValue, 'KRW')}</p></div><div><p className="mb-1 text-xs text-ink-mute">{category.gapValue >= 0 ? '목표까지 부족' : '목표보다 많음'}</p><p className="font-bold">{formatMoney(Math.abs(category.gapValue), 'KRW')}</p></div></div>
  </div>;
}

// Saved data stays in App's existing persistence flow; only navigation is local.
const TargetTab = (props) => {
  const {
    targetPortfolio, setTargetPortfolio, targetBudgetKRW, totalConvertedKRW,
    targetViewMode, setTargetViewMode, targetCategoryDraft, setTargetCategoryDraft,
    targetCategoryTotalPercent, targetPortfolioGuide, targetPriceSyncStatus,
    addTargetCategory, removeTargetCategory, updateTargetCategoryPercent, normalizeCategoryPercents,
    addTargetGroup, removeTargetGroup, updateTargetGroup, normalizeGroupPercents,
    addTargetItem, removeTargetItem, updateTargetItem, normalizeItemPercents,
    startTargetFromHoldings, startTargetManually, enhancedAssets,
    annualReturnYear, setAnnualReturnYear, annualPerformances, annualPerformanceYears,
    selectedAnnualPerformance, earliestAnnualYear, includeDividendsInReturn,
  } = props;
  const [section, setSection] = useState('allocation');
  const [chosenView, setChosenView] = useState(null);
  const [step, setStep] = useState(0);
  const [picker, setPicker] = useState(null);
  const [undo, setUndo] = useState(null);
  const headingRef = useRef(null);
  const hasExistingPlan = targetPortfolio.setupStarted || Boolean(targetPortfolio.budget)
    || targetPortfolioGuide.some((category) => category.groups.length > 0)
    || (targetPortfolio.categories.length > 0 && !targetPortfolio.categories.every((category) => Number(category.percent) === 0 || Number(category.percent) === 50));
  const view = chosenView || (hasExistingPlan ? 'summary' : 'start');
  const isCustomBudget = targetPortfolio.budgetMode === 'custom' || (!targetPortfolio.budgetMode && Boolean(targetPortfolio.budget));
  const issues = getTargetPlanIssues(targetPortfolioGuide, targetCategoryTotalPercent, targetBudgetKRW);
  const validBudget = targetBudgetKRW > 0 && (!isCustomBudget || Number(targetPortfolio.budget) > 0);
  const validCategories = targetPortfolio.categories.length > 0 && complete(targetCategoryTotalPercent)
    && targetPortfolio.categories.every((category) => Number.isFinite(Number(category.percent)) && Number(category.percent) >= 0 && Number(category.percent) <= 100);
  const availableCategories = PORTFOLIO_ASSET_CATEGORIES.filter((category) => !targetPortfolio.categories.some((entry) => entry.id === category));
  const hasHoldings = enhancedAssets.some((asset) => asset.currentKRW > 0);
  const canReview = validBudget && validCategories && issues.length === 0;
  const goToStep = (next) => { setChosenView('edit'); setStep(next); requestAnimationFrame(() => headingRef.current?.focus()); };
  const rememberAndRun = (action, message) => { setUndo({ categories: targetPortfolio.categories, groups: targetPortfolio.groups, items: targetPortfolio.items, message }); action(); };
  const restore = () => { setTargetPortfolio((previous) => ({ ...previous, categories: undo.categories, groups: undo.groups, items: undo.items })); setUndo(null); };
  const begin = (fromHoldings) => { if (fromHoldings) startTargetFromHoldings(); else startTargetManually(); goToStep(0); };
  const addCategory = () => {
    const categoryId = availableCategories.includes(targetCategoryDraft) ? targetCategoryDraft : availableCategories[0];
    if (categoryId === targetCategoryDraft) addTargetCategory();
    else setTargetPortfolio((previous) => ({ ...previous, categories: [...previous.categories, { id: categoryId, percent: 0 }], groups: { ...previous.groups, [categoryId]: [] }, items: { ...previous.items, [categoryId]: [] } }));
  };

  return <div className="space-y-5 anim-fade">
    <nav aria-label="목표 종류" className="inline-flex max-w-full gap-1 rounded-2xl bg-line-soft p-1.5">
      {[['allocation', '자산 배분 목표'], ['returns', '수익률 목표']].map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${section === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-mute hover:text-ink'}`}>{label}</button>)}
    </nav>
    {section === 'returns' ? <div className="space-y-6">
      <AnnualReturnGoalCard year={annualReturnYear} earliestYear={earliestAnnualYear} targetPercent={targetPortfolio.annualReturnGoals?.[annualReturnYear] || ''} performance={selectedAnnualPerformance} onYearChange={setAnnualReturnYear} onTargetChange={(value) => setTargetPortfolio((previous) => ({ ...previous, annualReturnGoals: { ...(previous.annualReturnGoals || {}), [annualReturnYear]: value } }))} />
      <AnnualReturnHistory year={annualReturnYear} earliestYear={earliestAnnualYear} years={annualPerformanceYears} performance={selectedAnnualPerformance} performances={annualPerformances} onYearChange={setAnnualReturnYear} includeDividends={includeDividendsInReturn} onIncludeDividendsChange={(value) => setTargetPortfolio((previous) => ({ ...previous, includeDividendsInReturn: value }))} />
    </div> : <section onChangeCapture={() => setUndo(null)} aria-label="자산 배분 계획" className="overflow-hidden rounded-[20px] bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5 md:p-7"><div><h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink outline-none">목표 포트폴리오 설정</h3><p className="mt-2 text-sm leading-relaxed text-ink-soft">원하는 투자 비중을 정하고, 현재 보유 구성과 비교해 보세요.</p></div>{view !== 'start' && <span className="text-xs text-ink-mute">변경사항은 자동 저장됩니다</span>}</div>
      {undo && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-brand-soft px-5 py-3 text-sm" role="status"><span>{undo.message}</span><button type="button" onClick={restore} className="inline-flex items-center gap-1.5 font-bold text-brand-strong"><Undo2 size={15} />되돌리기</button></div>}

      {view === 'start' && <div className="px-5 py-9 md:px-8 md:py-12"><div className="max-w-2xl space-y-6">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Target size={25} /></div>
        <div><h4 className="text-xl font-bold md:text-2xl">어떤 포트폴리오를 만들고 싶으세요?</h4><p className="mt-3 text-sm leading-7 text-ink-soft">보유 중인 종목과 비중을 가져오면 바꾸고 싶은 부분만 수정할 수 있어요.<br className="hidden md:block" /> 금액과 자산 비중만 정해도 계획을 만들 수 있습니다.</p></div>
        <div className="flex flex-col gap-3 sm:flex-row"><button type="button" disabled={!hasHoldings} onClick={() => begin(true)} className={primary}>현재 보유 구성에서 시작 <ArrowRight size={16} /></button><button type="button" onClick={() => begin(false)} className={secondary}>직접 설정하기</button></div>
        {!hasHoldings && <p className="text-xs text-ink-mute">등록된 보유 자산이 없어요. 직접 설정하거나 내 포트폴리오에 자산을 추가해 주세요.</p>}
        {targetPortfolio.categories.some((category) => Number(category.percent) > 0) && <p className="text-xs text-ink-mute">기존에 저장된 자산 비중은 ‘직접 설정하기’에서 이어서 수정할 수 있어요.</p>}
        <p className="border-t border-line pt-5 text-xs leading-6 text-ink-mute">1. 계획 금액 선택 → 2. 자산 비중 설정 → 3. 종목 배분 및 확인</p>
      </div></div>}

      {view === 'edit' && <>
        <div className="border-b border-line px-5 py-5 md:px-7"><ol className="grid grid-cols-3 gap-2" aria-label="설정 단계">{['계획 금액', '자산 비중', '종목 배분'].map((label, index) => <li key={label}><button type="button" aria-current={step === index ? 'step' : undefined} disabled={(index > 0 && !validBudget) || (index > 1 && !validCategories)} onClick={() => goToStep(index)} className={`flex w-full items-center gap-2 rounded-xl px-2 py-3 text-left text-xs font-bold sm:px-4 sm:text-sm ${step === index ? 'bg-brand-soft text-brand-strong' : 'text-ink-mute'} disabled:opacity-40`}><span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${step === index ? 'bg-brand text-white' : 'bg-canvas'}`}>{index + 1}</span>{label}</button></li>)}</ol></div>
        <div className="space-y-6 p-5 md:p-7">
          {step === 0 && <div className="max-w-2xl space-y-6">
            <div><h4 className="text-lg font-bold">얼마를 기준으로 목표를 정할까요?</h4><p className="mt-2 text-sm text-ink-soft">추가 투자금이 아닌, 목표 포트폴리오 전체 금액입니다.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><button type="button" aria-label="현재 총자산 사용" aria-pressed={!isCustomBudget} onClick={() => setTargetPortfolio((previous) => ({ ...previous, budgetMode: 'current', budget: '' }))} className={`rounded-2xl border-2 p-5 text-left ${!isCustomBudget ? 'border-brand bg-brand-soft' : 'border-line'}`}><span className="block text-sm font-bold">현재 총자산 사용</span><span className="mt-2 block text-xl font-bold">{formatMoney(totalConvertedKRW, 'KRW')}</span><span className="mt-2 block text-xs leading-5 text-ink-soft">보유 자산의 평가금액에 따라 함께 바뀝니다.</span></button><button type="button" aria-label="총금액 직접 입력" aria-pressed={isCustomBudget} onClick={() => setTargetPortfolio((previous) => ({ ...previous, budgetMode: 'custom', budget: previous.budget || '' }))} className={`rounded-2xl border-2 p-5 text-left ${isCustomBudget ? 'border-brand bg-brand-soft' : 'border-line'}`}><span className="block text-sm font-bold">총금액 직접 입력</span><span className="mt-2 block text-sm leading-6 text-ink-soft">추가 투자나 인출을 고려한<br />전체 목표 금액을 정해요.</span></button></div>
            {isCustomBudget && <div className="space-y-3"><label className="block space-y-2"><span className="text-sm font-bold">목표를 계산할 총금액 (원)</span><input aria-label="목표를 계산할 총금액" inputMode="numeric" value={formatInputNumber(targetPortfolio.budget)} onChange={(event) => setTargetPortfolio((previous) => ({ ...previous, budget: sanitizeNumericInput(event.target.value) }))} placeholder="예: 10,000,000" className={inputClass} /></label>{validBudget && <p className="text-sm leading-6 text-ink-soft">현재 {formatMoney(totalConvertedKRW, 'KRW')} {targetBudgetKRW >= totalConvertedKRW ? '+' : '−'} {formatMoney(Math.abs(targetBudgetKRW - totalConvertedKRW), 'KRW')} = 계획 {formatMoney(targetBudgetKRW, 'KRW')}</p>}</div>}
            {!validBudget && <p role="status" className="text-sm text-warn">0원보다 큰 총금액을 입력하거나 보유 자산을 등록해 주세요.</p>}
          </div>}

          {step === 1 && <div className="space-y-5"><div><h4 className="text-lg font-bold">전체 금액을 어떻게 나눌까요?</h4><p className="mt-2 text-sm text-ink-soft">계획 총금액 {formatMoney(targetBudgetKRW, 'KRW')}을 기준으로 합계 100%가 되도록 정해 주세요.</p></div>
            <div className="grid gap-4 md:grid-cols-2">{targetPortfolioGuide.map((category) => <div key={category.id} className="rounded-2xl border border-line p-4 md:p-5"><div className="mb-4 flex items-center justify-between gap-3"><h5 className="font-bold">{category.id}</h5><button type="button" aria-label={`${category.id} 목표 삭제`} onClick={() => rememberAndRun(() => removeTargetCategory(category.id), `${category.id} 목표를 삭제했어요.`)} className="rounded-lg p-2 text-ink-mute hover:bg-danger-soft hover:text-danger"><Trash2 size={16} /></button></div><PercentField label="전체 금액 중 비중" ariaLabel={`${category.id} 전체 목표 비중`} value={category.percent} onChange={(value) => updateTargetCategoryPercent(category.id, value)} /><div className="mt-4 flex flex-wrap justify-between gap-2 text-sm"><span className="text-ink-mute">목표 금액</span><span className="font-bold">{formatMoney(category.targetValue, 'KRW')}</span></div></div>)}</div>
            {availableCategories.length > 0 && <div className="flex flex-wrap gap-3"><select aria-label="추가할 자산 종류" value={availableCategories.includes(targetCategoryDraft) ? targetCategoryDraft : availableCategories[0]} onChange={(event) => setTargetCategoryDraft(event.target.value)} className={`${inputClass} max-w-52`}>{availableCategories.map((category) => <option key={category}>{category}</option>)}</select><button type="button" onClick={addCategory} className={secondary}><Plus size={16} />자산 종류 추가</button></div>}
            <AllocationStatus label="전체" total={targetCategoryTotalPercent} onNormalize={targetPortfolio.categories.length ? () => rememberAndRun(normalizeCategoryPercents, '입력한 비중을 합계 100%로 맞췄어요.') : null} />
          </div>}

          {step === 2 && <TargetAllocationEditor
            categories={targetPortfolioGuide} budget={targetBudgetKRW} priceSyncStatus={targetPriceSyncStatus}
            onPick={(categoryId, groupId) => setPicker({ categoryId, groupId })}
            onAddGroup={addTargetGroup} onRemoveGroup={removeTargetGroup} onUpdateGroup={updateTargetGroup}
            onNormalizeGroups={normalizeGroupPercents} onAddItem={addTargetItem} onRemoveItem={removeTargetItem}
            onUpdateItem={updateTargetItem} onNormalizeItems={normalizeItemPercents}
            rememberAndRun={rememberAndRun} onEdit={() => setUndo(null)}
          />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-5 md:px-7"><button type="button" onClick={() => step > 0 ? goToStep(step - 1) : setChosenView('summary')} className={secondary}><ArrowLeft size={16} />{step > 0 ? '이전' : '목표 요약'}</button>{step < 2 ? <button type="button" disabled={step === 0 ? !validBudget : !validCategories} onClick={() => goToStep(step + 1)} className={primary}>{step === 0 ? '다음: 자산 비중' : '다음: 종목 배분'}<ArrowRight size={16} /></button> : <button type="button" disabled={!canReview} onClick={() => { setChosenView('summary'); setTargetViewMode('table'); setTargetPortfolio((previous) => ({ ...previous, setupStarted: true })); requestAnimationFrame(() => headingRef.current?.focus()); }} className={primary}><Check size={17} />계획 확인</button>}</div>
      </>}

      {view === 'summary' && <div className="space-y-6 p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h4 className="text-lg font-bold">설정한 목표</h4><p className="mt-1 text-sm text-ink-soft">목표 총금액 <strong className="ml-1 text-ink">{formatMoney(targetBudgetKRW, 'KRW')}</strong></p><p className="mt-1 text-xs text-ink-mute">{isCustomBudget ? '직접 입력한 총금액 기준' : '현재 총자산에 따라 목표 금액도 바뀝니다'}</p></div><button type="button" onClick={() => goToStep(0)} className={primary}>목표 수정</button></div>
        {!canReview && <div className="rounded-xl bg-warn-soft p-4 text-sm leading-6 text-warn"><p className="font-bold">작성 중인 계획입니다</p><p>금액과 비중 설정을 마치면 비교 결과와 예상 조정 수량을 확인할 수 있어요.</p><ul className="mt-2 list-disc pl-5">{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul><button type="button" onClick={() => goToStep(!validBudget ? 0 : !validCategories ? 1 : 2)} className="mt-3 font-bold underline underline-offset-4">이어서 설정하기</button></div>}
        {canReview && <>
          <p className="text-xs leading-6 text-ink-mute">현재 비중은 현재 총자산 기준, 목표 비중은 목표 총금액 기준입니다.</p>
          <div className="grid gap-4 md:grid-cols-2">{targetPortfolioGuide.map((category) => <AllocationComparison key={category.id} category={category} />)}</div>
          <details className="rounded-2xl border border-line p-4 md:p-5"><summary className="cursor-pointer text-sm font-bold">종목별 차이와 예상 조정 수량</summary><p className="mt-3 text-xs leading-6 text-ink-mute">설정한 목표와 현재 보유액의 차이를 현재가로 나눈 값입니다. 수수료와 실제 주문 단위는 반영하지 않으며, 주문은 실행되지 않습니다.</p>
            <div className="mt-4 space-y-3">{targetPortfolioGuide.flatMap((category) => category.groups.flatMap((group) => group.items.map((item) => <div key={`${category.id}-${group.id}-${item.id}`} className="flex flex-wrap justify-between gap-3 rounded-xl bg-canvas p-4 text-sm"><div><p className="font-bold">{item.name || item.ticker}</p><p className="mt-1 text-xs text-ink-soft">현재 {formatMoney(item.currentValue, 'KRW')} → 목표 {formatMoney(item.targetValue, 'KRW')}</p></div><div className="text-right"><p className="font-bold">{Math.abs(item.gapValue) < 1 ? '목표와 같음' : `${item.gapValue > 0 ? '목표까지 부족' : '목표보다 많음'} ${formatMoney(Math.abs(item.gapValue), 'KRW')}`}</p><p className="mt-1 text-xs text-ink-soft">{Math.abs(item.gapValue) < 1 ? '조정할 금액이 없어요' : item.currentPriceKRW > 0 && item.adjustmentQuantity !== null ? `예상 ${item.gapValue > 0 ? '매수' : '매도'} ${Number(item.adjustmentQuantity.toFixed(3)).toLocaleString('ko-KR', { maximumFractionDigits: 3 })}주` : '현재가 확인 후 수량을 계산할 수 있어요'}</p></div></div>)))}{!targetPortfolioGuide.some((category) => category.groups.some((group) => group.items.length)) && <p className="text-sm text-ink-soft">자산 비중만 설정한 계획입니다. 종목을 추가하면 종목별 차이도 볼 수 있어요.</p>}</div>
            {targetPortfolioGuide.some((category) => category.unassignedValue > 0) && <div className="mt-4 rounded-xl bg-warn-soft p-4 text-xs leading-6 text-warn">목표에 포함하지 않은 보유 종목은 위 예상 수량에 포함되지 않습니다. {targetPortfolioGuide.filter((category) => category.unassignedValue > 0).map((category) => `${category.id} ${formatMoney(category.unassignedValue, 'KRW')}`).join(' · ')}</div>}
          </details>
          <button type="button" aria-expanded={targetViewMode === 'chart'} onClick={() => setTargetViewMode(targetViewMode === 'chart' ? 'table' : 'chart')} className={secondary}>구성 차트 {targetViewMode === 'chart' ? '접기' : '보기'}<ChevronDown size={16} /></button>
          {targetViewMode === 'chart' && <TargetPortfolioCharts {...props} />}
        </>}
      </div>}
    </section>}
    {picker && <TargetStockPicker categoryId={picker.categoryId} holdings={getTargetHoldingOptions(enhancedAssets, picker.categoryId)} existingItems={targetPortfolioGuide.find((category) => category.id === picker.categoryId)?.groups.flatMap((group) => group.items) || []} onSelect={(asset) => { setUndo(null); addTargetItem(picker.categoryId, picker.groupId, asset); setPicker(null); }} onClose={() => setPicker(null)} />}
  </div>;
};

export default TargetTab;
