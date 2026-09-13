// 수익 및 기록 탭.
// 평가손익 요약, 종목별 성과 표, 배당 내역(현재 보유 / 과거 보유), 매매 기록
// 목록과 인라인 편집기를 그린다. 이 탭만 쓰는 정렬 옵션은 여기에 두고, 금액과
// 목록은 모두 App이 계산해 넘겨준다.
import { Fragment } from 'react';
import {
  ArrowLeft, ArrowRightLeft, Banknote, DollarSign, NotebookPen, Pencil,
  Plus, PlusCircle, Receipt, Search, Trash2, TrendingUp, Wallet, X,
} from 'lucide-react';
import DividendIncomeSummary from '../DividendIncomeSummary.jsx';
import DividendSummaryGrid from '../DividendSummaryGrid.jsx';
import FeatureInfo from '../FeatureInfo.jsx';
import ManualTradeEntryForm from '../ManualTradeEntryForm.jsx';
import StockFilterCombobox from '../StockFilterCombobox.jsx';
import TradeRecordEditor from '../TradeRecordEditor.jsx';
import { getAccountTypeLabel } from '../../utils/accountTypes.js';
import {
  getDividendEligibilityDate,
  getDividendExDate,
  getDividendOfficialPaymentDate,
  getDividendReportingDate,
} from '../../utils/dividendDates.js';
import { isConfirmedDividendRecord } from '../../utils/dividendRecords.js';
import { formatMoney } from '../../utils/formatters.js';
import { TRADE_PAGE_SIZE, getRecordDate, getRecordPnl, getTradeSide } from '../../utils/tradeRecordView.js';

// 매매 기록 정렬 기준. 이 탭 바깥에서는 쓰지 않는다.
const TRADE_SORT_OPTIONS = [
  { value: 'date-desc', label: '최신순' },
  { value: 'date-asc', label: '오래된순' },
  { value: 'pnl-desc', label: '수익 높은순' },
  { value: 'pnl-asc', label: '수익 낮은순' },
];

const HistoryTab = ({
  dashboardSummary,
  totalConvertedNetProfit,
  krwGrossProfit,
  usdGrossProfit,
  overseasCapitalGainsTax,
  annualReturnYear,
  setAnnualReturnYear,
  earliestAnnualYear,
  selectedAnnualPerformance,
  performanceSearchTerm,
  setPerformanceSearchTerm,
  filteredPerformanceSummary,
  dividendFilter,
  setDividendFilter,
  selectedDividendAsset,
  setSelectedDividendAsset,
  filteredHistory,
  currentDividendSummaryGroups,
  historicalDividendSummaryGroups,
  historicalDividendCount,
  openActualDividendForm,
  removeConfirmedDividend,
  dividendImportInputRef,
  handleConfirmedDividendImport,
  isFetching,
  tradeStockFilter,
  setTradeStockFilter,
  tradeStockFilterOptions,
  tradeSideFilter,
  setTradeSideFilter,
  tradeSortMode,
  setTradeSortMode,
  tradeSummary,
  visibleTrades,
  displayedTrades,
  hasMoreTrades,
  setTradeVisibleCount,
  expandedTradeMemoId,
  setExpandedTradeMemoId,
  updateTradeRecord,
  removeTrade,
  removeTradeMemo,
  isManualTradeEntryOpen,
  setIsManualTradeEntryOpen,
  manualTradeStockOptions,
  manualMemo,
  setManualMemo,
  handleAddManualMemo,
}) => (
      <div className="space-y-8 anim-fade">
        <h3 className="text-lg md:text-xl font-bold text-ink flex items-center gap-2"><TrendingUp className="text-ink-soft" size={20} /> 평가손익(미실현) 요약</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><Banknote size={20} /></div>
            <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">국내주식 평가손익</p>
            <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${dashboardSummary.krwEvaluationProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {dashboardSummary.krwEvaluationProfit > 0 ? '+' : ''}{formatMoney(dashboardSummary.krwEvaluationProfit, 'KRW')}
            </p>
          </div>
          <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><DollarSign size={20} /></div>
            <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">해외주식 평가손익</p>
            <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${dashboardSummary.usdEvaluationProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {dashboardSummary.usdEvaluationProfit > 0 ? '+' : ''}{formatMoney(dashboardSummary.usdEvaluationProfit, 'USD')}
            </p>
          </div>
        </div>

        <h3 className="text-lg md:text-xl font-bold text-ink flex items-center gap-2"><ArrowRightLeft className="text-ink-soft" size={20} /> 종목 매매(실현) 수익 요약</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><Banknote size={20} /></div>
            <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">원화 매매 총수익</p>
            <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${krwGrossProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {krwGrossProfit > 0 ? '+' : ''}{formatMoney(krwGrossProfit, 'KRW')}
            </p>
          </div>
          <div className="bg-surface p-5 md:p-7 rounded-[20px] flex flex-col justify-center">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-canvas text-ink-soft rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-4"><DollarSign size={20} /></div>
            <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">달러 매매 총수익</p>
            <p className={`text-2xl md:text-3xl font-bold tracking-tighter ${usdGrossProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {usdGrossProfit > 0 ? '+' : ''}{formatMoney(usdGrossProfit, 'USD')}
            </p>
          </div>
          <div className="bg-ink p-5 md:p-7 rounded-2xl shadow-sm flex flex-col justify-center text-surface relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet size={50}/></div>
            <p className="text-ink-mute text-[12px] md:text-[13px] font-bold tracking-[0.06em] mb-1">총 환산 매매 순수익</p>
            <p className={`text-3xl md:text-4xl font-bold tracking-tighter ${totalConvertedNetProfit >= 0 ? 'text-up' : 'text-down'}`}>
              {totalConvertedNetProfit > 0 ? '+' : ''}{formatMoney(totalConvertedNetProfit, 'KRW')}
            </p>
          </div>
        </div>

        <div className="bg-surface rounded-[20px] overflow-hidden">
          <div className="p-5 md:p-7 border-b border-line flex items-center gap-2">
            <h3 className="text-base md:text-lg font-bold text-ink">
              {annualReturnYear}년 해외주식 양도소득세 (추정)
            </h3>
            <FeatureInfo text="같은 해 해외 종목 손익을 통산해 기본공제 250만원을 뺀 뒤 22%(양도세 20% + 지방소득세 2%)를 매깁니다. 국내주식과는 통산되지 않고, 환차익도 과세 대상이라 매수일·매도일 환율을 각각 적용합니다. 실제 신고는 이듬해 5월입니다." />
          </div>
          <div className="p-5 md:p-7 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-[11px] font-bold text-ink-mute">통산 양도차익</p>
              <p className={`figure text-lg md:text-xl font-bold mt-1 ${overseasCapitalGainsTax.netGainKRW >= 0 ? 'text-up' : 'text-down'}`}>
                {overseasCapitalGainsTax.netGainKRW > 0 ? '+' : ''}{formatMoney(overseasCapitalGainsTax.netGainKRW, 'KRW')}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-ink-mute">남은 기본공제</p>
              <p className="figure text-lg md:text-xl font-bold text-ink mt-1">
                {formatMoney(overseasCapitalGainsTax.remainingDeductionKRW, 'KRW')}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-ink-mute">과세표준</p>
              <p className="figure text-lg md:text-xl font-bold text-ink mt-1">
                {formatMoney(overseasCapitalGainsTax.taxBaseKRW, 'KRW')}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-ink-mute">예상 세액</p>
              <p className="figure text-lg md:text-xl font-bold text-ink mt-1">
                {formatMoney(overseasCapitalGainsTax.taxKRW, 'KRW')}
              </p>
            </div>
          </div>
          <p className="px-5 pb-5 md:px-7 md:pb-7 text-[11px] font-semibold text-ink-mute leading-relaxed">
            매도 {overseasCapitalGainsTax.tradeCount.toLocaleString()}건 기준
            {overseasCapitalGainsTax.estimated ? ' · 환율이나 취득가액이 없는 기록이 있어 일부는 추정했습니다.' : ''}
            {overseasCapitalGainsTax.unresolvedCount > 0
              ? ` · 취득가액을 알 수 없는 ${overseasCapitalGainsTax.unresolvedCount.toLocaleString()}건은 뺐습니다.`
              : ''}
          </p>
        </div>

        <div className="bg-surface rounded-[20px] overflow-hidden">
          <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface">
            <div className="flex items-center gap-2">
              <h3 className="text-base md:text-lg font-bold text-ink">종목별 총 손익</h3>
              <FeatureInfo text="평가손익, 실현손익, 세후 배당을 합산합니다." />
            </div>
            <div className="relative w-full md:w-72">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute" />
              <input
                value={performanceSearchTerm}
                onChange={(e) => setPerformanceSearchTerm(e.target.value)}
                placeholder="종목명 또는 티커 검색"
                className="w-full pl-10 pr-4 py-3 bg-canvas rounded-xl outline-none focus:ring-2 focus:ring-brand text-xs md:text-sm font-bold text-ink-soft"
              />
            </div>
          </div>
          {/* 페이지가 이미 세로로 스크롤되는데 카드 안에 또 스크롤을 두면,
              더 있다는 표시도 없이 종목이 잘려 보인다(7종목 중 4종목만 노출됐다). */}
          <div className="overflow-x-auto">
            <table className="w-full text-left table-auto">
              <thead className="sticky top-0 z-10 bg-canvas text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em]">
                <tr>
                  <th className="px-4 py-4 md:px-8 md:py-5">종목</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">보유/매도</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">평가 손익</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">실현 손익</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">세후 배당</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">수익률</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">총 손익</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {filteredPerformanceSummary.map((summary) => {
                  const isForeignCurrency = summary.currency !== 'KRW';
                  const unrealizedDisplay = isForeignCurrency ? summary.unrealizedNative : summary.unrealizedKRW;
                  const realizedDisplay = isForeignCurrency ? summary.realizedNative : summary.realizedKRW;
                  const dividendDisplay = isForeignCurrency ? summary.dividendNative : summary.dividendKRW;
                  const totalDisplay = isForeignCurrency ? summary.totalNative : summary.totalKRW;
                  const displayCurrency = isForeignCurrency ? summary.currency : 'KRW';
                  const totalTone = totalDisplay >= 0 ? 'text-up bg-up-soft' : 'text-down bg-down-soft';
                  return (
                    <tr key={summary.key || summary.name} className="hover:bg-canvas transition-colors">
                      <td className="px-4 py-4 md:px-8 md:py-6 whitespace-nowrap">
                        <p className="text-sm md:text-base font-bold text-ink">{summary.name}</p>
                        <p className="text-[11px] md:text-[12px] font-bold text-ink-mute mt-1">
                          {summary.ticker || summary.category || '기록 종목'}
                          {summary.displayDate && ` • ${summary.displayDate} ${summary.displayDateLabel}`}
                        </p>
                      </td>
                      <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                        {/* 이미 정리된 포지션은 매도 수량이 주인공이므로 위로 올린다.
                            보유 중인 종목은 반대로 보유 수량이 먼저다. */}
                        {summary.isClosedPosition ? (
                          <>
                            <div>매도 {summary.totalSellQuantity.toLocaleString()}주</div>
                            <div className="text-ink-mute mt-1">보유 {summary.quantity.toLocaleString()}주</div>
                          </>
                        ) : (
                          <>
                            <div>보유 {summary.quantity.toLocaleString()}주</div>
                            <div className="text-ink-mute mt-1">매도 {summary.totalSellQuantity.toLocaleString()}주</div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                        {unrealizedDisplay > 0 ? '+' : ''}{formatMoney(unrealizedDisplay, displayCurrency)}
                      </td>
                      <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                        {realizedDisplay > 0 ? '+' : ''}{formatMoney(realizedDisplay, displayCurrency)}
                      </td>
                      <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                        {dividendDisplay > 0 ? '+' : ''}{formatMoney(dividendDisplay, displayCurrency)}
                      </td>
                      <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                        {/* 투입원가(보유분 원금 + 매도분 취득원가) 대비 총 손익.
                            금액만으로는 원금이 다른 종목끼리 비교가 되지 않는다. */}
                        {summary.returnPercentKRW === null ? (
                          <span className="text-xs md:text-sm font-bold text-ink-mute" title="투입원가를 확인할 수 없습니다">—</span>
                        ) : (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={`text-xs md:text-sm font-bold tnum ${summary.returnPercentKRW >= 0 ? 'text-up' : 'text-down'}`}>
                              {summary.returnPercentKRW > 0 ? '+' : ''}{summary.returnPercentKRW.toFixed(2)}%
                            </span>
                            <span className="text-[11px] md:text-[12px] font-bold text-ink-mute tnum">
                              원금 {formatMoney(summary.investedKRW, 'KRW')}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
                          {isForeignCurrency && (
                            <>
                              <span className={`inline-flex px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold ${totalTone}`}>
                                {summary.totalNative > 0 ? '+' : ''}{formatMoney(summary.totalNative, summary.currency)}
                              </span>
                              <span className="text-[12px] md:text-xs font-bold text-ink-mute">
                                원화 기준 합계 {summary.totalKRW > 0 ? '+' : ''}{formatMoney(summary.totalKRW, 'KRW')}
                              </span>
                            </>
                          )}
                          {!isForeignCurrency && (
                            <span className={`inline-flex px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold ${totalTone}`}>
                              {summary.totalKRW > 0 ? '+' : ''}{formatMoney(summary.totalKRW, 'KRW')}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredPerformanceSummary.length === 0 && (
              <p className="p-8 md:p-10 text-center text-ink-mute font-bold text-xs md:text-sm">검색 결과가 없습니다.</p>
            )}
          </div>
        </div>

        <div className="bg-surface p-5 md:p-7 rounded-[20px]">
          <div className="mb-6">
            <DividendIncomeSummary
              year={annualReturnYear}
              summary={selectedAnnualPerformance.dividendIncome}
              earliestYear={earliestAnnualYear}
              onYearChange={setAnnualReturnYear}
            />
          </div>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-3 md:gap-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg md:text-xl font-bold flex items-center gap-2 md:gap-3">
                <Receipt className="text-ink-soft" size={20}/>
                {selectedDividendAsset ? `${selectedDividendAsset} 배당 상세 기록` : '종목별 누적 배당 요약'}
              </h3>
              <FeatureInfo text="실제 입금액을 우선하고, 나머지는 공식 분배금과 기준일 보유수량으로 계산합니다." />
            </div>
          
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <input
                ref={dividendImportInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleConfirmedDividendImport}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => dividendImportInputRef.current?.click()}
                className="text-[11px] md:text-[12px] font-bold text-ink-soft bg-line-soft px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:bg-line transition-all"
              >
                <ArrowRightLeft size={12} /> 복구 파일 불러오기
              </button>
              <button
                type="button"
                onClick={openActualDividendForm}
                className="text-[11px] md:text-[12px] font-bold text-white bg-brand px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:opacity-90 transition-all"
              >
                <Plus size={12} /> 실제 입금 추가
              </button>
              {selectedDividendAsset && (
                <>
                <select 
                  value={dividendFilter} 
                  onChange={e => setDividendFilter(e.target.value)}
                  className="px-3 py-1.5 md:px-4 md:py-2 bg-canvas rounded-lg md:rounded-xl text-[12px] md:text-xs font-bold outline-none text-ink-soft"
                >
                  <option value="이번 달">이번 달</option>
                  <option value="올해">올해</option>
                  <option value="전체">전체 기간</option>
                </select>
                <button onClick={() => { setSelectedDividendAsset(null); setDividendFilter('전체'); }} className="text-[11px] md:text-[12px] font-bold text-ink-soft bg-line-soft px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center gap-1 hover:bg-line transition-all">
                  <ArrowLeft size={12} /> 전체 보기
                </button>
                </>
              )}
            </div>
          </div>

          {!selectedDividendAsset ? (
            <div className="pr-1 md:pr-2">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {currentDividendSummaryGroups.length > 0 && (
                <DividendSummaryGrid
                  groups={currentDividendSummaryGroups}
                  onSelect={setSelectedDividendAsset}
                />
              )}

              {historicalDividendCount > 0 && (
                <details className="col-span-full rounded-2xl border border-line bg-canvas/60 overflow-hidden">
                  <summary className="cursor-pointer list-none px-5 py-4 md:px-6 md:py-5 flex items-center justify-between gap-3 font-bold text-sm md:text-base text-ink hover:bg-canvas">
                    <span>과거 보유 · 배당 수령 내역</span>
                    <span className="text-[11px] md:text-xs text-ink-mute">{historicalDividendCount}종목 · 클릭하여 보기</span>
                  </summary>
                  <div className="border-t border-line p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    <DividendSummaryGrid
                      groups={historicalDividendSummaryGroups}
                      onSelect={setSelectedDividendAsset}
                    />
                  </div>
                </details>
              )}

              {currentDividendSummaryGroups.length === 0 && historicalDividendCount === 0 && (
                <div className="col-span-full py-8 md:py-12 text-center text-ink-mute font-bold text-xs md:text-sm">
                  {isFetching ? '배당 데이터를 갱신 중입니다...' : '매수일 이후 배당 내역이 없거나 데이터를 불러올 수 없습니다.'}
                </div>
              )}
              </div>
            </div>
          ) : (
            <div className="bg-canvas rounded-2xl p-1 md:p-2">
              <div className="overflow-x-auto">
                <table className="w-full text-left table-auto">
                  <thead className="text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em] border-b border-line/50">
                    <tr>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">기준 수량</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">주당 세후</th>
                      <th className="px-4 py-4 md:px-8 md:py-5">지급 기준 일자</th>
                      <th className="px-4 py-4 md:px-8 md:py-5">종목명</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">세전</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">세금</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-right">세후</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-center">상태</th>
                      <th className="px-4 py-4 md:px-8 md:py-5 text-center">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {filteredHistory.length > 0 ? filteredHistory.map(div => (
                      <tr key={div.id} className="hover:bg-surface transition-colors group">
                        <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">{Number(div.quantity) > 0 ? `${Number(div.quantity).toLocaleString()}주` : '-'}</td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">{Number(div.perShareNetAmount) > 0 ? formatMoney(div.perShareNetAmount, div.currency) : '-'}</td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">
                          {(div.actualPaymentDate || div.paymentDate)
                            ? `지급일 ${getDividendReportingDate(div)}`
                            : `배당락일 ${getDividendExDate(div)}`}
                          <span className="block mt-1 text-[11px] text-ink-mute">
                            {`배당기준일 ${div.recordDate || getDividendEligibilityDate(div) || getDividendExDate(div)}`}
                          </span>
                          <span className="block mt-1 text-[11px] text-ink-mute">
                            배당지급일 {getDividendOfficialPaymentDate(div) || '미정'}
                          </span>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-sm md:text-base font-bold text-ink whitespace-nowrap">{div.name}</td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-ink-soft whitespace-nowrap">{Number.isFinite(Number(div.grossAmount)) ? formatMoney(div.grossAmount, div.currency) : '-'}</td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-right text-xs md:text-sm font-bold text-down whitespace-nowrap">{Number.isFinite(Number(div.taxAmount)) ? `-${formatMoney(div.taxAmount, div.currency)}` : '-'}</td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-right text-sm md:text-base font-bold text-ink whitespace-nowrap">{formatMoney(div.amount, div.currency)}</td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-center whitespace-nowrap">
                          <span className="text-[11px] md:text-[12px] bg-up-soft text-up px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl font-bold">
                            {isConfirmedDividendRecord(div)
                              ? '실제 입금·확정'
                              : `${getAccountTypeLabel(div.accountType)} · 자동 계산`}
                          </span>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-5 text-center whitespace-nowrap">
                          {isConfirmedDividendRecord(div) ? (
                            <button
                              type="button"
                              onClick={() => removeConfirmedDividend(div.id)}
                              className="p-2 text-ink-mute hover:text-danger hover:bg-danger-soft rounded-xl transition-colors"
                              title="실제 입금 기록 삭제"
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : '-'}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                          <td colSpan="9" className="px-4 py-12 md:px-8 md:py-16 text-center">
                          <p className="text-ink-mute font-bold mb-2 text-xs md:text-sm">해당하는 배당 지급 내역이 없습니다.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="bg-surface rounded-[20px] overflow-hidden">
          <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:justify-between md:items-center gap-3 bg-surface">
            <div className="flex items-center gap-2">
              <h3 className="text-base md:text-lg font-bold text-ink">과거 매매 기록 · 메모</h3>
              <FeatureInfo text="매수·매도 내역과 당시 판단 근거를 한곳에서 관리합니다. 연필 버튼으로 거래일·단가·수수료·메모를 고칠 수 있습니다." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsManualTradeEntryOpen((previous) => !previous)}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-ink text-surface rounded-xl font-bold text-xs shadow-sm"
              >
                {isManualTradeEntryOpen ? <X size={16} /> : <PlusCircle size={16} />}
                {isManualTradeEntryOpen ? '입력 닫기' : '누락 매매 기록 추가'}
              </button>
            </div>
          </div>
          {isManualTradeEntryOpen && (
            <ManualTradeEntryForm
              value={manualMemo}
              stockOptions={manualTradeStockOptions}
              onChange={setManualMemo}
              onSubmit={handleAddManualMemo}
              onClose={() => setIsManualTradeEntryOpen(false)}
            />
          )}
          <div className="p-5 md:p-6 border-b border-line bg-surface space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <StockFilterCombobox
                value={tradeStockFilter}
                onChange={setTradeStockFilter}
                options={tradeStockFilterOptions}
                ariaLabel="과거 매매 기록 종목 필터"
              />
              <select
                value={tradeSideFilter}
                onChange={(e) => setTradeSideFilter(e.target.value)}
                aria-label="매수 또는 매도 필터"
                className="px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft"
              >
                <option value="all">전체 거래</option>
                <option value="buy">매수</option>
                <option value="sell">매도</option>
              </select>
              <select
                value={tradeSortMode}
                onChange={(e) => setTradeSortMode(e.target.value)}
                className="px-4 h-13 bg-canvas rounded-2xl outline-none focus:ring-2 focus:ring-brand font-bold text-xs md:text-sm text-ink-soft"
              >
                {TRADE_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className={`grid grid-cols-1 gap-3 ${tradeStockFilter !== 'all' ? 'md:grid-cols-3' : ''}`}>
              {tradeStockFilter !== 'all' && (
                <>
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-[12px] font-bold text-ink-mute mb-1">총 매수 수량</p>
                    <p className="text-lg font-bold text-ink">{tradeSummary.totalBuyQuantity.toLocaleString()}</p>
                  </div>
                  <div className="bg-canvas rounded-xl p-4">
                    <p className="text-[12px] font-bold text-ink-mute mb-1">총 매도 수량</p>
                    <p className="text-lg font-bold text-ink">{tradeSummary.totalSellQuantity.toLocaleString()}</p>
                  </div>
                </>
              )}
              <div className="bg-canvas rounded-xl p-4">
                <p className="text-[12px] font-bold text-ink-mute mb-1">실현 손익</p>
                <p className={`text-lg font-bold ${tradeSummary.totalProfit >= 0 ? 'text-up' : 'text-down'}`}>
                  {tradeSummary.totalProfit > 0 ? '+' : ''}{formatMoney(tradeSummary.totalProfit, 'KRW')}
                </p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left table-auto">
              <thead className="bg-canvas/50 text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em]">
                <tr>
                  <th className="px-4 py-4 md:px-8 md:py-5">종목</th>
                  <th className="px-4 py-4 md:px-8 md:py-5">매수/매도일</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">매수가/매도가</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-right">실현 손익</th>
                  <th className="px-4 py-4 md:px-8 md:py-5">메모</th>
                  <th className="px-4 py-4 md:px-8 md:py-5 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {displayedTrades.map((trade) => {
                  const side = getTradeSide(trade);
                  const action = side === 'sell' ? '매도' : '매수';
                  const date = getRecordDate(trade);
                  const price = side === 'sell'
                    ? (trade.price || trade.sellPrice)
                    : (trade.price || trade.buyPrice);
                  const pnl = getRecordPnl(trade);
                  const brokerFee = Number(trade.brokerFee) || 0;
                  const sellTax = Number(trade.sellTax) || 0;
                  const rowKey = `${trade.sourceType}-${trade.id}`;
                  const isMemoExpanded = expandedTradeMemoId === rowKey;

                  return (
                    <Fragment key={rowKey}>
                      <tr className={`transition-colors ${isMemoExpanded ? 'bg-canvas/70' : 'hover:bg-canvas'}`}>
                        <td className="px-4 py-4 md:px-8 md:py-6 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex px-2 py-1 rounded-lg text-[12px] font-bold ${side === 'sell' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>
                              {action}
                            </span>
                            <div>
                              <p className="text-sm md:text-base font-bold text-ink">{trade.name}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                {trade.ticker && (
                                  <p className="text-[11px] md:text-[12px] font-bold text-ink-mute">{trade.ticker}</p>
                                )}
                                {trade.isUnlinkedMemo && (
                                  <span className="inline-flex px-2 py-0.5 rounded-md bg-warn-soft text-warn text-[10px] font-bold">미연결 기록</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-[12px] md:text-xs text-ink-soft font-bold whitespace-nowrap">
                          <span className="text-ink-mute mr-1 md:mr-2">{action}일:</span>{date || '-'}
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-right text-xs md:text-sm font-bold text-ink-soft space-y-1 whitespace-nowrap">
                          <div>{formatMoney(price, trade.currency)}</div>
                          <div className="text-ink-mute">{Number(trade.quantity || 0).toLocaleString()}주</div>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-right whitespace-nowrap">
                          {side === 'sell' ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className={`inline-flex font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl text-[12px] md:text-xs ${pnl >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                                {pnl > 0 ? '+' : ''}{formatMoney(pnl, trade.currency)}
                              </span>
                              {brokerFee > 0 && (
                                <span className="text-[11px] font-bold text-ink-mute">
                                  수수료 -{formatMoney(brokerFee, trade.currency)}
                                </span>
                              )}
                              {sellTax > 0 && (
                                <span className="text-[11px] font-bold text-ink-mute">
                                  제세금 -{formatMoney(sellTax, trade.currency)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[12px] md:text-xs font-bold text-ink-mute">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 min-w-48 max-w-72">
                          <button
                            type="button"
                            onClick={() => setExpandedTradeMemoId((previous) => previous === rowKey ? '' : rowKey)}
                            title={trade.memo || '메모 추가'}
                            className={`w-full inline-flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${trade.memo ? 'bg-brand-soft text-ink-soft' : 'bg-canvas text-ink-mute hover:text-ink'}`}
                          >
                            <NotebookPen size={15} className="shrink-0" />
                            <span className="truncate text-[11px] md:text-xs font-bold">{trade.memo || '메모 추가'}</span>
                          </button>
                        </td>
                        <td className="px-4 py-4 md:px-8 md:py-6 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedTradeMemoId((previous) => previous === rowKey ? '' : rowKey)}
                            aria-expanded={isMemoExpanded}
                            className={`transition-colors p-1.5 md:p-2 rounded-xl ${isMemoExpanded ? 'text-brand bg-brand-soft' : 'text-ink-mute hover:text-brand hover:bg-brand-soft'}`}
                            title={`${action}일·${action}가·수수료·메모 수정`}
                            aria-label={`${trade.name} ${action} 기록 수정`}
                          >
                            <Pencil size={16} />
                          </button>
                          {!trade.isUnlinkedMemo ? (
                            <button onClick={(e) => removeTrade(trade, e)} className="text-ink-mute hover:text-danger hover:bg-danger-soft transition-colors p-1.5 md:p-2 rounded-xl" title={side === 'sell' ? '매도 기록 삭제 · 보유 수량 다시 계산' : '매수 기록 삭제 · 보유 수량 다시 계산'}><Trash2 size={16} /></button>
                          ) : (
                            <div className="inline-flex items-center justify-center gap-2">
                              <span className="text-[11px] font-bold text-ink-mute">메모만 보존</span>
                              <button
                                type="button"
                                onClick={(e) => removeTradeMemo(trade, e)}
                                className="text-ink-mute hover:text-danger hover:bg-danger-soft transition-colors p-1.5 md:p-2 rounded-xl"
                                title="보존된 미연결 기록 삭제"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isMemoExpanded && (
                        <tr>
                          <td colSpan="6" className="px-4 pb-4 md:px-8 md:pb-6 bg-canvas/40">
                            <TradeRecordEditor
                              key={rowKey}
                              record={trade}
                              onSave={(draft) => updateTradeRecord(trade, draft)}
                              onDelete={(event) => removeTradeMemo(trade, event)}
                              onClose={() => setExpandedTradeMemoId('')}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {visibleTrades.length === 0 && <p className="p-8 md:p-10 text-center text-ink-mute font-bold text-xs md:text-sm">표시할 매매 기록이 없습니다.</p>}
          </div>
          {visibleTrades.length > 0 && (
            <div className="px-5 py-4 md:px-8 md:py-5 border-t border-line bg-canvas/40 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <p className="text-[12px] md:text-xs font-bold text-ink-mute">
                최근 {displayedTrades.length.toLocaleString()}개 표시 중 / 전체 {visibleTrades.length.toLocaleString()}개
              </p>
              <div className="flex gap-2">
                {hasMoreTrades && (
                  <button
                    onClick={() => setTradeVisibleCount(count => count + TRADE_PAGE_SIZE)}
                    className="px-4 py-2 bg-canvas rounded-xl text-[12px] md:text-xs font-bold text-ink-soft hover:text-ink transition-colors"
                  >
                    더보기
                  </button>
                )}
                {displayedTrades.length > TRADE_PAGE_SIZE && (
                  <button
                    onClick={() => setTradeVisibleCount(TRADE_PAGE_SIZE)}
                    className="px-4 py-2 bg-canvas rounded-xl text-[12px] md:text-xs font-bold text-ink-mute hover:text-ink-soft transition-colors"
                  >
                    접기
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
);

export default HistoryTab;
