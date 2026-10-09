import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Layers3, Plus, Trash2 } from 'lucide-react';
import { formatMoney, sanitizeNumericInput } from '../utils/formatters.js';
import { getTargetHoldingOptions, getTargetPlanIssues } from '../utils/targetPortfolio.js';

const field = 'w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';
const action = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-ink-soft hover:bg-line-soft';
const percent = (value) => Number(Number(value || 0).toFixed(2)).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const isComplete = (value) => Math.abs(Number(value) - 100) < 0.001;
const currencies = ['USD', 'JPY', 'HKD', 'GBP', 'EUR', 'CAD', 'AUD', 'CHF', 'CNY', 'SGD', 'TWD', 'INR'];

function CompactPercent({ value, label, scope, onChange }) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-[11px] font-medium text-ink-mute">{scope}</span>
    <span className="relative block">
      <input aria-label={label} inputMode="decimal" value={typeof value === 'number' ? Number(value.toFixed(4)) : value}
        onFocus={(event) => event.target.select()}
        onChange={(event) => onChange(sanitizeNumericInput(event.target.value))}
        className={`${field} min-h-11 pr-7 text-right`} />
      <span className="pointer-events-none absolute right-3 top-3 text-xs text-ink-mute">%</span>
    </span>
  </label>;
}

function AllocationMeter({ total, label, onNormalize, required = true }) {
  const complete = isComplete(total);
  const remainder = 100 - total;
  const text = !required ? '현재 목표에서 제외된 배분입니다'
    : complete ? '100% 배분 완료'
      : remainder > 0 ? `남은 비중 ${percent(remainder)}%` : `${percent(-remainder)}% 초과`;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
      <p aria-live="polite" className={`inline-flex items-center gap-1.5 font-semibold ${required && !complete ? 'text-warn' : 'text-ink-soft'}`}>
        {complete && required && <Check size={14} aria-hidden="true" />}{text}
        {!complete && required && <span className="font-normal text-ink-mute">· {percent(total)}% 배분</span>}
      </p>
      {!complete && onNormalize && <button type="button" onClick={onNormalize} className="min-h-9 text-xs font-bold text-brand-strong underline underline-offset-4">
        {total > 0 ? '입력한 비율대로 100% 맞추기' : '똑같이 나누기'}
      </button>}
    </div>
    <div role="progressbar" aria-label={`${label} 배분 현황`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.max(0, Math.min(100, total))} aria-valuetext={text} className="h-1.5 overflow-hidden rounded-full bg-line-soft">
      <div className={`h-full rounded-full ${total > 100.001 && required ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${Math.max(0, Math.min(100, total))}%` }} />
    </div>
  </div>;
}

function StockRow({ item, category, group, grouped, onUpdate, onRemove, onFill }) {
  const infoId = useId();
  const name = item.name || item.ticker || '새 종목';
  const needsInfo = !item.currency || (!item.name && !item.ticker) || item.isDuplicate;
  const [infoOpen, setInfoOpen] = useState(needsInfo);
  const remainder = 100 - group.itemTotalPercent;
  const canFill = remainder > 0.001 && group.items.every((entry) => Number.isFinite(Number(entry.percent)) && Number(entry.percent) >= 0 && Number(entry.percent) <= 100);
  return <div role="listitem" className="border-t border-line first:border-t-0">
    <div className="relative grid grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_7rem_11rem_2.5rem] md:items-center md:gap-x-5 md:px-5">
      <div className="col-span-2 min-w-0 pr-8 pt-1 md:col-span-1 md:pr-0">
        <p className="break-words text-sm font-bold leading-6 text-ink">{name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-mute">
          {item.ticker && <span className="break-all">{item.ticker}</span>}
          <span>{item.isMatched ? '보유 중' : '신규 편입'}</span>
          <button type="button" aria-label={`${name} 종목 정보`} aria-expanded={infoOpen} aria-controls={infoId}
            onClick={() => setInfoOpen(!infoOpen)} className="inline-flex min-h-8 items-center gap-0.5 text-xs text-ink-soft hover:text-brand-strong">
            상세 <ChevronDown size={12} className={infoOpen ? 'rotate-180' : ''} />
          </button>
        </div>
        {needsInfo && <p className="mt-1 text-xs text-warn">{item.isDuplicate ? '중복 종목을 확인해 주세요' : '종목 정보를 확인해 주세요'}</p>}
      </div>
      <div className="col-start-2 row-start-2 md:row-start-1">
        <CompactPercent label={`${name} 목표 비중`} scope={grouped ? '묶음 안 비중' : `${category.id} 내`} value={item.percent} onChange={(value) => onUpdate({ percent: value })} />
        {canFill && <button type="button" aria-label={`${name}에 남은 비중 채우기`} onClick={onFill}
          className="mt-1 min-h-8 w-full text-right text-[11px] font-semibold text-brand-strong">남은 {percent(remainder)}% 채우기</button>}
      </div>
      <div className="col-start-1 row-start-2 self-center space-y-1 text-xs md:col-start-3 md:row-start-1 md:text-right">
        <p className="font-semibold text-ink"><span className="mb-1 block text-[11px] font-normal text-ink-mute md:hidden">목표 금액</span>{formatMoney(item.targetValue, 'KRW')}</p>
        <p className="text-[11px] text-ink-mute md:mt-1">전체 자산의 {percent(item.overallPercent)}%</p>
      </div>
      <button type="button" aria-label={`${name} 목표 삭제`} onClick={onRemove}
        className="absolute right-2 top-2 inline-flex min-h-11 w-9 items-center justify-center rounded-lg text-ink-mute hover:bg-danger-soft hover:text-danger md:static md:col-start-4 md:row-start-1 md:mt-4 md:w-auto"><Trash2 size={15} /></button>
    </div>
    {infoOpen && <div id={infoId} className="space-y-4 border-t border-line-soft bg-canvas/70 px-4 py-4 md:px-5">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-soft">
        <span>현재 보유액 <strong>{formatMoney(item.currentValue, 'KRW')}</strong></span>
        <span>{item.currentPriceKRW > 0 ? `현재가 ${formatMoney(item.currentPriceKRW, 'KRW')}` : '현재가 확인 필요'}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5 text-xs text-ink-soft"><span className="block">종목명</span><input aria-label={`${name} 종목명 수정`} value={item.name || ''} onChange={(event) => onUpdate({ name: event.target.value })} className={field} /></label>
        <label className="space-y-1.5 text-xs text-ink-soft"><span className="block">티커</span><input aria-label={`${name} 티커 수정`} value={item.ticker || ''} onChange={(event) => onUpdate({ ticker: event.target.value.toUpperCase(), price: '', nativePrice: '', priceSource: '', priceUpdatedAt: '' })} className={field} /></label>
        <label className="space-y-1.5 text-xs text-ink-soft"><span className="block">거래 통화</span><select aria-label={`${name} 거래 통화`} value={item.currency || ''} onChange={(event) => onUpdate({ currency: event.target.value, price: '', nativePrice: '', priceSource: '', priceUpdatedAt: '' })} className={field}>
          <option value="">통화 선택</option>{(category.id === '국내주식' ? ['KRW'] : currencies).map((code) => <option key={code}>{code}</option>)}
        </select></label>
      </div>
    </div>}
  </div>;
}

function AllocationGroup({ category, group, grouped, expanded, onToggle, onAdd, onUpdateGroup, onRemoveGroup, onUpdateItem, onRemoveItem, onNormalize, onFill }) {
  const listId = useId();
  const name = group.name || '새 묶음';
  const required = Number(category.percent) > 0 && Number(group.percent) > 0;
  return <section aria-label={`${grouped ? name : category.id} 종목 배분 목록`} className="overflow-clip rounded-2xl border border-line">
    {grouped && <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 bg-canvas/60 px-4 py-3 md:px-5">
      <button type="button" aria-label={`${name} 종목 ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} aria-controls={listId} onClick={onToggle} className="flex min-h-14 min-w-0 items-start gap-2 text-left">
        <ChevronDown size={17} className={`mt-1 shrink-0 text-ink-mute ${expanded ? '' : '-rotate-90'}`} />
        <span className="min-w-0"><span className="block break-words text-sm font-bold">{name}</span><span className="mt-1 block text-xs leading-5 text-ink-soft">{group.items.length}개 종목 · {formatMoney(group.targetValue, 'KRW')}</span>
          <span className={`mt-1 block text-[11px] ${required && !isComplete(group.itemTotalPercent) ? 'text-warn' : 'text-ink-mute'}`}>{!required ? '목표 배분 제외' : isComplete(group.itemTotalPercent) ? '종목 배분 완료' : `종목 비중 ${percent(group.itemTotalPercent)}% · 확인 필요`}</span>
        </span>
      </button>
      <CompactPercent label={`${name} 묶음 비중`} scope={`${category.id} 내`} value={group.percent} onChange={(value) => onUpdateGroup({ percent: value })} />
    </div>}
    {expanded && <div id={listId}>
      <div className="space-y-3 px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink-soft">{grouped ? `${name} 묶음 안에서 100% 배분` : `${category.id} 안에서 100% 배분`}</p>
          <button type="button" onClick={onAdd} className={`${action} bg-brand-soft text-brand-strong hover:bg-brand-soft/70`}><Plus size={15} />종목 추가</button>
        </div>
        {group.items.length > 0 && <AllocationMeter label={grouped ? name : category.id} total={group.itemTotalPercent} required={required} onNormalize={onNormalize} />}
      </div>
      {group.items.length > 0 ? <>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_7rem_11rem_2.5rem] gap-x-5 border-t border-line-soft bg-canvas/40 px-5 py-2 text-[11px] font-medium text-ink-mute md:grid">
          <span>종목</span><span className="text-right">{grouped ? '묶음 안 비중' : `${category.id} 내 비중`}</span><span className="text-right">목표 금액 / 전체 비중</span><span />
        </div>
        <div role="list" aria-label={`${grouped ? name : category.id} 목표 종목`}>
          {group.items.map((item) => <StockRow key={item.id} item={item} category={category} group={group} grouped={grouped}
            onUpdate={(patch) => onUpdateItem(item.id, patch)} onRemove={() => onRemoveItem(item.id)} onFill={() => onFill(item)} />)}
        </div>
      </> : <p className="px-4 pb-5 text-sm leading-6 text-ink-mute md:px-5">이 묶음에 담을 종목을 추가해 주세요.</p>}
      {grouped && <details open={group.items.length === 0 ? true : undefined} className="border-t border-line bg-canvas/30 px-4 py-2 md:px-5">
        <summary className="w-fit cursor-pointer py-2 text-xs font-semibold text-ink-soft">묶음 설정</summary>
        <div className="flex flex-wrap items-end gap-3 pb-3">
          <label className="min-w-0 flex-1 space-y-1.5 text-xs text-ink-soft"><span className="block">묶음 이름</span><input aria-label={`${category.id} 묶음 이름`} value={group.name || ''} placeholder="예: 빅테크" onChange={(event) => onUpdateGroup({ name: event.target.value })} className={field} /></label>
          <button type="button" aria-label={`${name} 묶음 삭제`} onClick={onRemoveGroup} className={`${action} text-danger hover:bg-danger-soft`}><Trash2 size={15} />묶음 삭제</button>
        </div>
        <p className="pb-3 text-[11px] text-ink-mute">이 묶음은 전체 자산의 {percent(Number(category.percent) * Number(group.percent) / 100)}%입니다.</p>
      </details>}
    </div>}
  </section>;
}

export default function TargetAllocationEditor({
  categories, budget, priceSyncStatus, onPick, onAddGroup, onRemoveGroup, onUpdateGroup,
  onNormalizeGroups, onAddItem, onRemoveItem, onUpdateItem, onNormalizeItems, rememberAndRun, onEdit,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [groupControls, setGroupControls] = useState({});
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [holdingDestinations, setHoldingDestinations] = useState({});
  const categoryHeading = useRef(null);
  const category = categories.find((entry) => entry.id === selectedId)
    || categories.find((entry) => entry.groups.some((group) => group.items.length > 0))
    || categories.find((entry) => Number(entry.percent) > 0) || categories[0];
  const categoryIssues = categories.map((entry) => ({ category: entry, issues: getTargetPlanIssues([entry], 100, budget) }));
  const pendingCategories = categoryIssues.filter((entry) => entry.issues.length > 0);
  if (!category) return <p className="text-sm text-ink-soft">먼저 자산 비중을 설정해 주세요.</p>;
  const grouped = groupControls[category.id] || category.groups.length > 1 || category.groups.some((group) => !group.isDefault || !isComplete(group.percent));
  const unassignedHoldings = getTargetHoldingOptions(category.unassignedAssets, category.id);
  const chosenDestination = category.groups.find((group) => group.id === holdingDestinations[category.id])?.id || category.groups[0]?.id || null;
  const selectCategory = (id, revealIssues = false) => {
    setSelectedId(id);
    if (revealIssues) {
      const entry = categories.find((candidate) => candidate.id === id);
      setCollapsedGroups((previous) => ({ ...previous, ...Object.fromEntries(entry.groups.map((group) => [group.id, false])) }));
      requestAnimationFrame(() => categoryHeading.current?.focus());
    }
  };
  const fillRemaining = (group, item) => {
    const otherTotal = group.items.reduce((sum, entry) => sum + (entry.id === item.id ? 0 : Number(entry.percent) || 0), 0);
    const nextPercent = Math.round((100 - otherTotal) * 1e8) / 1e8;
    if (!(nextPercent >= 0 && nextPercent <= 100) || group.itemTotalPercent >= 99.999) return;
    rememberAndRun(() => onUpdateItem(category.id, group.id, item.id, { percent: nextPercent }), `${item.name || item.ticker}에 남은 비중을 배분했어요.`);
  };

  return <section aria-label="종목 배분 편집" className="space-y-5">
    <div><h4 className="text-lg font-bold">종목별로 얼마나 담을까요?</h4><p className="mt-2 text-sm leading-6 text-ink-soft">비중을 입력하면 목표 금액이 바로 계산돼요. 종목 선택은 나중에 해도 괜찮습니다.</p></div>
    {categories.length > 1 && <nav aria-label="배분할 자산 종류" className="grid grid-cols-2 gap-2 rounded-2xl bg-canvas p-1.5">
      {categoryIssues.map(({ category: entry, issues }) => <button key={entry.id} type="button" aria-label={`${entry.id} 종목 배분`} aria-pressed={category.id === entry.id}
        onClick={() => selectCategory(entry.id)} className={`min-w-0 rounded-xl px-3 py-3 text-left ${category.id === entry.id ? 'bg-surface shadow-sm' : 'hover:bg-surface/60'}`}>
        <span className={`block text-sm font-bold ${category.id === entry.id ? 'text-brand-strong' : 'text-ink-soft'}`}>{entry.id}</span>
        <span className="mt-1 block text-xs text-ink-soft">{formatMoney(entry.targetValue, 'KRW')}</span>
        <span className={`mt-1 block text-[11px] ${issues.length ? 'text-warn' : 'text-ink-mute'}`}>{issues.length ? `확인 필요 ${issues.length}건` : entry.groups.length ? '배분 완료' : '종목 선택 안 함'}</span>
      </button>)}
    </nav>}

    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h5 ref={categoryHeading} tabIndex={-1} className="text-base font-bold outline-none">{category.id}</h5><p className="mt-1 text-sm font-semibold">{formatMoney(category.targetValue, 'KRW')} <span className="ml-1 text-xs font-normal text-ink-mute">전체 자산의 {percent(category.percent)}%</span></p></div>
      {!grouped && <button type="button" onClick={() => setGroupControls((previous) => ({ ...previous, [category.id]: true }))} className={action}><Layers3 size={15} />종목을 묶어서 관리</button>}
    </div>
    {grouped && category.groups.length > 0 && <div className="rounded-xl bg-canvas/70 px-4 py-3">
      <p className="mb-2 text-xs font-semibold text-ink-soft">{category.id} 금액을 묶음별로 나누기</p>
      <AllocationMeter label={`${category.id} 묶음`} total={category.groupTotalPercent} required={Number(category.percent) > 0 && category.groups.length > 0}
        onNormalize={category.groups.length ? () => rememberAndRun(() => onNormalizeGroups(category.id), '묶음 비중을 100%로 맞췄어요.') : null} />
    </div>}

    <div className="space-y-3">
      {category.groups.map((group, index) => {
        const expanded = !grouped || !(collapsedGroups[group.id] ?? (index > 0 && group.items.length > 0));
        return <AllocationGroup key={group.id} category={category} group={group} grouped={grouped} expanded={expanded}
          onToggle={() => setCollapsedGroups((previous) => ({ ...previous, [group.id]: expanded }))}
          onAdd={() => {
            setCollapsedGroups((previous) => ({ ...previous, [group.id]: false }));
            onPick(category.id, group.id);
          }}
          onUpdateGroup={(patch) => { onEdit(); onUpdateGroup(category.id, group.id, patch); }}
          onRemoveGroup={() => rememberAndRun(() => onRemoveGroup(category.id, group.id), '종목 묶음을 삭제했어요.')}
          onUpdateItem={(itemId, patch) => { onEdit(); onUpdateItem(category.id, group.id, itemId, patch); }}
          onRemoveItem={(itemId) => rememberAndRun(() => onRemoveItem(category.id, group.id, itemId), '목표 종목을 삭제했어요.')}
          onNormalize={() => rememberAndRun(() => onNormalizeItems(category.id, group.id), '종목 비중을 100%로 맞췄어요.')}
          onFill={(item) => fillRemaining(group, item)} />;
      })}
    </div>
    {category.groups.length === 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line p-5">
      <div><p className="text-sm font-semibold text-ink-soft">아직 담은 종목이 없어요</p><p className="mt-1 text-xs text-ink-mute">자산 비중만으로도 계획을 확인할 수 있습니다.</p></div>
      {!grouped && <button type="button" onClick={() => onPick(category.id, null)} className={`${action} bg-brand-soft text-brand-strong`}><Plus size={15} />종목 추가</button>}
    </div>}
    {grouped && <button type="button" onClick={() => { onEdit(); onAddGroup(category.id); }} className={`${action} w-full border border-dashed border-line`}><Plus size={15} />종목 묶음 추가</button>}

    {unassignedHoldings.length > 0 && <details className="rounded-xl bg-canvas/50 px-4 py-2">
      <summary className="cursor-pointer py-2 text-xs font-semibold text-ink-soft">아직 목표에 넣지 않은 보유 종목 {unassignedHoldings.length}개</summary>
      {category.groups.length > 1 && <label className="mt-2 block max-w-xs space-y-1.5 text-xs text-ink-soft"><span className="block">추가할 묶음</span><select aria-label={`${category.id} 보유 종목을 추가할 묶음`} value={chosenDestination || ''} onChange={(event) => setHoldingDestinations((previous) => ({ ...previous, [category.id]: event.target.value }))} className={field}>{category.groups.map((group) => <option key={group.id} value={group.id}>{group.name || '새 묶음'}</option>)}</select></label>}
      <div className="mt-2 flex flex-wrap gap-2 pb-2">{unassignedHoldings.map((asset) => <button key={asset.id} type="button" onClick={() => {
        onEdit(); onAddItem(category.id, chosenDestination, asset);
        if (chosenDestination) setCollapsedGroups((previous) => ({ ...previous, [chosenDestination]: false }));
      }} className={`${action} max-w-full bg-surface text-left`}><span className="break-words">{asset.name} · 목표에 추가</span><Plus size={13} className="shrink-0" /></button>)}</div>
    </details>}

    {pendingCategories.length > 0 && <div role="status" className="space-y-3 rounded-xl bg-warn-soft p-4 text-xs leading-6 text-warn">
      <p className="font-bold">계획 확인 전에 정리해 주세요</p>
      {pendingCategories.map(({ category: entry, issues }) => <div key={entry.id}>
        <button type="button" onClick={() => selectCategory(entry.id, true)} className="inline-flex min-h-9 items-center gap-1 font-bold underline underline-offset-4">{entry.id} 확인 <ChevronRight size={14} /></button>
        <ul className="list-disc pl-4">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </div>)}
    </div>}
    {priceSyncStatus && <p className="text-[11px] text-ink-mute">{priceSyncStatus}</p>}
  </section>;
}
