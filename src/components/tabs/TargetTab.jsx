// 목표 포트폴리오 탭.
// 목표 비중(분류 → 그룹 → 종목 3단계)을 편집하고, 현재 비중과 나란히 비교하는
// 도넛 차트와 리밸런싱 안내를 그린다. 연간 목표 수익률 카드와 연도별 수익률
// 기록도 이 탭에 함께 둔다. 목표 비중 상태는 App이 들고 있고, 여기서는 편집
// 콜백을 호출하기만 한다.
import { ArrowLeft, Folder, Plus, Trash2 } from 'lucide-react';
import AnnualReturnGoalCard from '../AnnualReturnGoalCard.jsx';
import AnnualReturnHistory from '../AnnualReturnHistory.jsx';
import FeatureInfo from '../FeatureInfo.jsx';
import { PORTFOLIO_ASSET_CATEGORIES } from '../../constants.js';
import { formatInputNumber, formatMoney, sanitizeNumericInput } from '../../utils/formatters.js';

const TargetTab = ({
  targetPortfolio,
  setTargetPortfolio,
  targetBudgetKRW,
  totalConvertedKRW,
  targetViewMode,
  setTargetViewMode,
  targetCategoryDraft,
  setTargetCategoryDraft,
  targetCategoryTotalPercent,
  targetGoalChartData,
  targetCurrentChartData,
  targetDrilldownChartData,
  targetCurrentDrilldownChartData,
  targetPortfolioGuide,
  selectedTargetGuide,
  selectedTargetGroupGuide,
  setSelectedTargetCategory,
  setSelectedTargetGroup,
  targetPriceSyncStatus,
  addTargetCategory,
  removeTargetCategory,
  updateTargetCategoryPercent,
  normalizeCategoryPercents,
  addTargetGroup,
  removeTargetGroup,
  updateTargetGroup,
  normalizeGroupPercents,
  addTargetItem,
  removeTargetItem,
  updateTargetItem,
  normalizeItemPercents,
  annualReturnYear,
  setAnnualReturnYear,
  annualPerformances,
  annualPerformanceYears,
  selectedAnnualPerformance,
  earliestAnnualYear,
  includeDividendsInReturn,
}) => (
      <div className="space-y-8 anim-fade">
        <AnnualReturnGoalCard
          year={annualReturnYear}
          earliestYear={earliestAnnualYear}
          targetPercent={targetPortfolio.annualReturnGoals?.[annualReturnYear] || ''}
          performance={selectedAnnualPerformance}
          onYearChange={setAnnualReturnYear}
          onTargetChange={(value) => setTargetPortfolio((previous) => ({
            ...previous,
            annualReturnGoals: {
              ...(previous.annualReturnGoals || {}),
              [annualReturnYear]: value,
            },
          }))}
        />
        <AnnualReturnHistory
          year={annualReturnYear}
          earliestYear={earliestAnnualYear}
          years={annualPerformanceYears}
          performance={selectedAnnualPerformance}
          performances={annualPerformances}
          onYearChange={setAnnualReturnYear}
          includeDividends={includeDividendsInReturn}
          onIncludeDividendsChange={(value) => setTargetPortfolio((previous) => ({
            ...previous,
            includeDividendsInReturn: value,
          }))}
        />
        <div className="bg-surface rounded-[20px] overflow-hidden">
          <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface">
            <div className="flex items-center gap-2">
              <h3 className="text-base md:text-lg font-bold text-ink">목표 포트폴리오 설정</h3>
              <FeatureInfo text="분류별 목표 비중과 분류 안 종목별 목표 비중을 저장합니다." />
            </div>
            <div className="w-full md:w-80">
              <label htmlFor="app-field-1" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                기준 총 예산
              </label>
              <input id="app-field-1"
                value={formatInputNumber(targetPortfolio.budget)}
                onChange={(e) => setTargetPortfolio(prev => ({ ...prev, budget: sanitizeNumericInput(e.target.value) }))}
                placeholder={`현재 총자산 ${formatMoney(totalConvertedKRW, 'KRW')}`}
                className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand text-sm font-bold text-ink"
              />
            </div>
          </div>

          <div className="p-5 md:p-6 border-b border-line bg-surface">
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1">
                <label htmlFor="app-field-2" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                  분류 추가
                </label>
                <select id="app-field-2"
                  value={targetCategoryDraft}
                  onChange={(e) => setTargetCategoryDraft(e.target.value)}
                  className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft"
                >
                  {PORTFOLIO_ASSET_CATEGORIES.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={addTargetCategory}
                className="h-12 px-5 bg-ink text-surface rounded-2xl font-bold text-[14px] flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                <Plus size={16} /> 분류 추가
              </button>
              <div className={`px-5 py-3 rounded-xl border text-xs md:text-sm font-bold ${Math.abs(targetCategoryTotalPercent - 100) < 0.001 ? 'bg-brand-soft text-brand' : 'bg-warn-soft text-warn'}`}>
                전체 목표 {targetCategoryTotalPercent.toFixed(1)}%
              </div>
              {Math.abs(targetCategoryTotalPercent - 100) >= 0.001 && targetPortfolio.categories.length > 0 && (
                <button
                  onClick={normalizeCategoryPercents}
                  className="px-4 py-3 bg-line-soft text-ink-soft rounded-xl font-bold text-xs hover:bg-line transition-colors"
                  title="지금 넣은 비율은 유지한 채 합만 100%로 맞춥니다"
                >
                  100%로 맞추기
                </button>
              )}
              {targetPriceSyncStatus && (
                <div className="px-5 py-3 rounded-xl border bg-canvas border-line text-ink-soft text-xs md:text-sm font-bold">
                  {targetPriceSyncStatus}
                </div>
              )}
              <div className="flex bg-line-soft rounded-xl p-1">
                {[
                  { id: 'table', label: '표' },
                  { id: 'chart', label: '파이그래프' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setTargetViewMode(mode.id)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${targetViewMode === mode.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-mute hover:text-ink-soft'}`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {targetViewMode === 'chart' && (
            <div className="p-5 md:p-7 border-b border-line grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[
                {
                  title: selectedTargetGroupGuide
                    ? `${selectedTargetGroupGuide.name || '미분류'} 현재 보유`
                    : selectedTargetGuide
                      ? `${selectedTargetGuide.id} 현재 보유`
                      : '현재 포트폴리오',
                  data: selectedTargetGuide ? targetCurrentDrilldownChartData : targetCurrentChartData,
                  center: selectedTargetGroupGuide
                    ? formatMoney(selectedTargetGroupGuide.currentValue, 'KRW')
                    : selectedTargetGuide
                      ? formatMoney(selectedTargetGuide.currentValue, 'KRW')
                      : formatMoney(totalConvertedKRW, 'KRW'),
                  drilldown: true,
                },
                {
                  title: selectedTargetGroupGuide
                    ? `${selectedTargetGroupGuide.name || '미분류'} 세부 종목`
                    : selectedTargetGuide
                      ? `${selectedTargetGuide.id} 목표 내부`
                      : '목표 포트폴리오',
                  data: selectedTargetGuide ? targetDrilldownChartData : targetGoalChartData,
                  center: selectedTargetGroupGuide
                    ? formatMoney(selectedTargetGroupGuide.targetValue, 'KRW')
                    : selectedTargetGuide
                      ? formatMoney(selectedTargetGuide.targetValue, 'KRW')
                      : formatMoney(targetBudgetKRW, 'KRW'),
                  drilldown: true,
                  showBackButton: true,
                },
              ].map((chart) => (
                <div key={chart.title} className="bg-canvas rounded-2xl p-5 md:p-6">
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <h4 className="text-sm md:text-base font-bold text-ink">{chart.title}</h4>
                    {chart.showBackButton && selectedTargetGuide ? (
                      <button
                        onClick={() => {
                          if (selectedTargetGroupGuide) {
                            setSelectedTargetGroup(null);
                          } else {
                            setSelectedTargetCategory(null);
                          }
                        }}
                        className="text-[12px] font-bold text-ink-soft bg-canvas px-3 py-1.5 rounded-xl flex items-center gap-1"
                      >
                        <ArrowLeft size={12} /> {selectedTargetGroupGuide ? '폴더 목록' : '전체 목표'}
                      </button>
                    ) : (
                      <span className="text-[12px] font-bold text-ink-mute">{chart.center}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 items-center">
                    <div className="relative w-52 h-52 mx-auto">
                      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                        {chart.data.map((item) => (
                          <circle
                            key={item.id}
                            cx="18"
                            cy="18"
                            r="15.9"
                            fill="transparent"
                            stroke={item.color}
                            strokeWidth="3.8"
                            strokeDasharray={`${item.percent} ${100 - item.percent}`}
                            strokeDashoffset={-item.startPercent}
                            className={chart.drilldown && !selectedTargetGroupGuide ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
                            onClick={() => {
                              if (chart.drilldown && !selectedTargetGuide) {
                                setSelectedTargetCategory(item.name);
                                setSelectedTargetGroup(null);
                              }
                              else if (chart.drilldown && selectedTargetGuide && !selectedTargetGroupGuide && item.groupId) setSelectedTargetGroup(item.groupId);
                            }}
                          />
                        ))}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-[12px] font-bold text-ink-mute">
                          {selectedTargetGroupGuide && chart.drilldown ? selectedTargetGroupGuide.name : selectedTargetGuide && chart.drilldown ? selectedTargetGuide.id : 'Total'}
                        </span>
                        <span className="text-sm font-bold text-ink mt-1">{chart.center}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {chart.data.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (chart.drilldown && !selectedTargetGuide) {
                              setSelectedTargetCategory(item.name);
                              setSelectedTargetGroup(null);
                            }
                            else if (chart.drilldown && selectedTargetGuide && !selectedTargetGroupGuide && item.groupId) setSelectedTargetGroup(item.groupId);
                          }}
                          className={`w-full flex items-center justify-between gap-3 bg-surface rounded-xl px-4 py-3 text-left ${chart.drilldown && !selectedTargetGroupGuide ? 'hover:text-ink transition-colors' : ''}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                            <span className="text-xs font-bold text-ink-soft truncate">{item.name}</span>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-bold text-ink">{item.percent.toFixed(1)}%</p>
                            <p className="text-[12px] font-bold text-ink-mute">{formatMoney(item.value, 'KRW')}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {targetViewMode === 'chart' && (
            <div className="p-5 md:p-7 border-b border-line">
              <h4 className="text-sm md:text-base font-bold text-ink mb-1">카테고리별 현재 vs 목표 비중</h4>
              <p className="text-[11px] md:text-xs font-semibold text-ink-mute mb-5">두 파이그래프만으로는 비교하기 어려운 차이를 막대로 바로 보여줍니다.</p>
              <div className="space-y-5">
                {targetPortfolioGuide.map((category) => {
                  const currentPct = Math.max(0, Math.min(100, category.currentPercent));
                  const targetPct = Math.max(0, Math.min(100, Number(category.percent) || 0));
                  const gapPercentPoint = category.currentPercent - targetPct;
                  return (
                    <div key={category.id}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs md:text-sm font-bold text-ink">{category.id}</span>
                        {Math.abs(gapPercentPoint) > 0.05 && (
                          <span className="text-[11px] md:text-xs font-bold text-ink-mute">
                            목표 대비 {gapPercentPoint > 0 ? '+' : ''}{gapPercentPoint.toFixed(1)}%p
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-9 shrink-0 text-[10px] font-bold text-ink-mute">현재</span>
                          <div className="flex-1 h-2.5 rounded-full bg-line-soft overflow-hidden">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(currentPct, currentPct > 0 ? 1 : 0)}%` }} />
                          </div>
                          <span className="w-14 shrink-0 text-right text-[11px] font-bold text-ink">{category.currentPercent.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-9 shrink-0 text-[10px] font-bold text-ink-mute">목표</span>
                          <div className="flex-1 h-2.5 rounded-full bg-line-soft overflow-hidden">
                            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(targetPct, targetPct > 0 ? 1 : 0)}%` }} />
                          </div>
                          <span className="w-14 shrink-0 text-right text-[11px] font-bold text-ink">{targetPct.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {targetPortfolioGuide.length === 0 && (
                  <p className="text-xs font-bold text-ink-mute">분류를 추가하면 여기에 비교 막대가 표시됩니다.</p>
                )}
              </div>
            </div>
          )}

          {targetViewMode === 'table' && (
          <div className="divide-y divide-line-soft">
            {targetPortfolioGuide.map((category) => (
              <div key={category.id} className="p-5 md:p-7 space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr_auto] gap-3 lg:items-end">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm md:text-base font-bold text-ink">{category.id}</p>
                      {category.buyCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-up-soft text-up text-[10px] font-bold">매수 {category.buyCount}</span>
                      )}
                      {category.sellCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-down-soft text-down text-[10px] font-bold">매도 {category.sellCount}</span>
                      )}
                    </div>
                    <p className="text-[12px] md:text-xs font-bold text-ink-mute mt-1">
                      현재 {category.currentPercent.toFixed(1)}% / 목표 {Number(category.percent || 0).toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <label htmlFor="app-field-3" className="block text-[11px] md:text-[12px] font-bold text-ink-mute mb-1.5 ml-1">
                      목표 비중
                    </label>
                    <input id="app-field-3"
                      inputMode="decimal"
                      value={category.percent}
                      onChange={(e) => updateTargetCategoryPercent(category.id, e.target.value)}
                      className="w-full px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand text-sm font-bold text-ink"
                    />
                  </div>
                  <button
                    onClick={() => removeTargetCategory(category.id)}
                    className="px-4 py-3 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors justify-self-start lg:justify-self-end"
                    title="분류 삭제"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-[12px] font-bold text-ink-mute mb-1">현재 가치</p>
                    <p className="text-lg font-bold text-ink">{formatMoney(category.currentValue, 'KRW')}</p>
                  </div>
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-[12px] font-bold text-ink-mute mb-1">목표 가치</p>
                    <p className="text-lg font-bold text-ink">{formatMoney(category.targetValue, 'KRW')}</p>
                  </div>
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-[12px] font-bold text-ink-mute mb-1">{category.gapValue >= 0 ? '추가 필요 금액' : '목표 초과 금액'}</p>
                    <p className={`text-lg font-bold ${category.gapValue >= 0 ? 'text-up' : 'text-down'}`}>
                      {formatMoney(Math.abs(category.gapValue), 'KRW')}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs md:text-sm font-bold text-ink">분류 안 폴더 목표</p>
                      <p className={`text-[12px] md:text-xs font-bold mt-1 ${Math.abs(category.groupTotalPercent - 100) < 0.001 || category.groups.length === 0 ? 'text-ink-mute' : 'text-warn'}`}>
                        폴더 목표 합계 {category.groupTotalPercent.toFixed(1)}%
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {Math.abs(category.groupTotalPercent - 100) >= 0.001 && category.groups.length > 0 && (
                        <button
                          onClick={() => normalizeGroupPercents(category.id)}
                          className="px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs hover:bg-line transition-colors"
                          title="지금 넣은 비율은 유지한 채 합만 100%로 맞춥니다"
                        >
                          100%로 맞추기
                        </button>
                      )}
                      <button
                        onClick={() => addTargetGroup(category.id)}
                        className="px-4 py-2.5 bg-line-soft text-ink-soft rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-line transition-colors"
                      >
                        <Plus size={14} /> 폴더 추가
                      </button>
                    </div>
                  </div>

                  {category.groups.map((group) => (
                    <div key={group.id} className="bg-canvas rounded-2xl p-4 md:p-5 space-y-3">
                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.5fr_auto_auto] gap-2 lg:items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder size={17} className="text-ink-soft shrink-0" />
                          <input
                            value={group.name}
                            onChange={(e) => updateTargetGroup(category.id, group.id, { name: e.target.value })}
                            placeholder="폴더명 예: 빅테크"
                            className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                          />
                        </div>
                        <input
                          inputMode="decimal"
                          value={group.percent}
                          onChange={(e) => updateTargetGroup(category.id, group.id, { percent: sanitizeNumericInput(e.target.value) })}
                          placeholder="폴더 비중 %"
                          className="px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                        />
                        <button
                          onClick={() => addTargetItem(category.id, group.id)}
                          className="px-3 py-2.5 bg-canvas text-ink-soft rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-canvas transition-colors"
                        >
                          <Plus size={13} /> 종목
                        </button>
                        <button
                          onClick={() => removeTargetGroup(category.id, group.id)}
                          className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
                          title="폴더 삭제"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[12px] md:text-xs font-bold">
                        <span className="bg-surface rounded-xl px-3 py-2 text-ink-soft">폴더 목표 {Number(group.percent || 0).toFixed(1)}%</span>
                        <span className="bg-surface rounded-xl px-3 py-2 text-ink">목표 {formatMoney(group.targetValue, 'KRW')}</span>
                        <span className="bg-surface rounded-xl px-3 py-2 text-ink-soft">현재 {formatMoney(group.currentValue, 'KRW')}</span>
                        {Math.abs(group.itemTotalPercent - 100) >= 0.001 && group.items.length > 0 ? (
                          <button
                            onClick={() => normalizeItemPercents(category.id, group.id)}
                            className="bg-warn-soft text-warn rounded-xl px-3 py-2 text-left hover:opacity-80 transition-opacity"
                            title="지금 넣은 비율은 유지한 채 합만 100%로 맞춥니다"
                          >
                            종목 합계 {group.itemTotalPercent.toFixed(1)}% · 100%로 맞추기
                          </button>
                        ) : (
                          <span className="text-ink-soft bg-surface rounded-xl px-3 py-2">
                            종목 합계 {group.itemTotalPercent.toFixed(1)}%
                          </span>
                        )}
                      </div>

                      <div className="space-y-2 pl-3 md:pl-5 border-l-2 border-line">
                        {group.items.map((item) => (
                          <div key={item.id} className="grid grid-cols-1 lg:grid-cols-[1fr_0.8fr_0.55fr_0.8fr_auto] gap-2 bg-surface rounded-2xl p-3">
                            <div className="relative">
                              <input
                                value={item.name}
                                onChange={(e) => updateTargetItem(category.id, group.id, item.id, { name: e.target.value })}
                                placeholder="종목명"
                                className="w-full px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                              />
                              {!item.isMatched && (item.name || item.ticker) && (
                                <span
                                  className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-warn-soft text-warn text-[9px] font-bold"
                                  title="현재 보유 종목과 자동으로 매칭되지 않았습니다. 종목명 또는 티커를 확인하세요."
                                >
                                  미연동
                                </span>
                              )}
                            </div>
                            <input
                              value={item.ticker}
                              onChange={(e) => updateTargetItem(category.id, group.id, item.id, { ticker: e.target.value.toUpperCase() })}
                              placeholder="티커"
                              className="px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                            />
                            <input
                              inputMode="decimal"
                              value={item.percent}
                              onChange={(e) => updateTargetItem(category.id, group.id, item.id, { percent: sanitizeNumericInput(e.target.value) })}
                              placeholder="%"
                              className="px-3 py-2.5 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold"
                            />
                            <div className="px-3 py-2.5 bg-canvas rounded-xl text-xs md:text-sm font-bold text-ink-soft">
                              {item.currentPriceKRW > 0 ? (
                                <>
                                  <span className="block text-[11px] font-bold text-ink-mute">자동 현재가</span>
                                  <span>{formatMoney(item.currentPriceKRW, 'KRW')}</span>
                                  {item.currency && item.currency !== 'KRW' && (
                                    <span className="block text-[12px] text-ink-soft mt-0.5">{formatMoney(item.currentPriceNative, item.currency)}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-ink-mute">티커 입력 시 자동 연동</span>
                              )}
                            </div>
                            <button
                              onClick={() => removeTargetItem(category.id, group.id, item.id)}
                              className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
                              title="종목 삭제"
                            >
                              <Trash2 size={15} />
                            </button>
                            <div className="lg:col-span-5 grid grid-cols-1 md:grid-cols-[1fr_1fr_1.3fr] gap-2 text-[12px] md:text-xs font-bold">
                              <span className="bg-canvas rounded-xl px-3 py-2 text-ink-soft">현재 {formatMoney(item.currentValue, 'KRW')}</span>
                              <span className="bg-canvas rounded-xl px-3 py-2 text-ink">목표 {formatMoney(item.targetValue, 'KRW')}</span>
                              <span className={`rounded-xl px-3 py-2 ${
                                item.adjustmentSide === 'buy'
                                  ? 'bg-up-soft text-up'
                                  : item.adjustmentSide === 'sell'
                                    ? 'bg-down-soft text-down'
                                    : 'bg-canvas text-ink-soft'
                              }`}>
                                {item.adjustmentSide === 'buy'
                                  ? `매수 필요 · ${formatMoney(Math.abs(item.gapValue), 'KRW')} (${item.adjustmentQuantity.toFixed(3)}주)`
                                  : item.adjustmentSide === 'sell'
                                    ? `매도 필요 · ${formatMoney(Math.abs(item.gapValue), 'KRW')} (${item.adjustmentQuantity.toFixed(3)}주)`
                                    : '조정 필요 없음'}
                              </span>
                            </div>
                          </div>
                        ))}
                        {group.items.length === 0 && (
                          <p className="px-3 py-4 text-xs font-bold text-ink-mute">이 폴더에 종목을 추가하세요.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {category.unassignedAssets.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs md:text-sm font-bold text-ink">계획에 없는 보유 종목</p>
                      <p className="text-[12px] md:text-xs font-bold text-warn mt-1">
                        이 분류에 속하지만 목표 계획(폴더·종목)에 연결되지 않은 보유 자산입니다 · 합계 {formatMoney(category.unassignedValue, 'KRW')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {category.unassignedAssets.map((asset) => (
                        <span
                          key={asset.id || `${asset.name}-${asset.ticker}`}
                          className="inline-flex items-center gap-1.5 bg-warn-soft/60 rounded-full pl-3 pr-2.5 py-1.5 text-[12px] md:text-xs font-bold"
                          title={formatMoney(asset.currentKRW, 'KRW')}
                        >
                          <span className="text-ink">{asset.name}</span>
                          <span className="text-warn">{formatMoney(asset.currentKRW, 'KRW')}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
);

export default TargetTab;
