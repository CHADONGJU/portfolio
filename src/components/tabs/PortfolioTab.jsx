// 포트폴리오 탭.
// 총 평가금액·수익률 히어로, 보조 지표 3개, 자산 비중 도넛 차트(분류 → 종목
// 드릴다운), 보유 종목 상세 표를 그린다. 금액 계산은 App이 usePortfolioMetrics로
// 끝내서 넘겨주고, 여기서는 표시용 파생값(색 톤, 차트 그라디언트)만 만든다.
import { useMemo } from 'react';
import {
  ArrowLeft, CalendarDays, Minus, PieChart as PieIcon, Plus, Sparkles, Target,
  Trash2, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { formatMoney } from '../../utils/formatters.js';
import { canSummarizeAsset } from '../../utils/stockInsightPayload.js';

// 해외주식은 소수점 매수가 가능해 소수 여섯 자리까지 보여준다.
const formatAssetQuantity = (quantity, category) => {
  const number = Number(quantity);
  if (!Number.isFinite(number)) return '0';

  if (category === '해외주식') {
    return number.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  }

  return number.toLocaleString();
};

const PortfolioTab = ({
  totalConvertedKRW,
  totalConvertedNetProfit,
  dashboardSummary,
  dividendCurrencyParts,
  portfolioAssets,
  visibleDetailAssets,
  selectedCategory,
  setSelectedCategory,
  currentChartData,
  currentCategoryKRW,
  currentCategoryUSD,
  currentCategoryTotalConverted,
  currentCategoryProfitKRW,
  currentCategoryProfitUSD,
  assetCurrencyView,
  setAssetCurrencyView,
  setIsAdding,
  setInsightAsset,
  openAddBuyModal,
  openSellModal,
  openBuyLotsModal,
  requestRemoveAsset,
}) => {
  const isDomesticStockChart = selectedCategory?.includes('국내') && selectedCategory?.includes('주식');
  const isOverseasStockChart = selectedCategory?.includes('해외') && selectedCategory?.includes('주식');
  const profitTone = currentCategoryProfitKRW >= 0 ? 'text-up' : 'text-down';
  const profitBgTone = currentCategoryProfitKRW >= 0 ? 'bg-up-soft border-up-soft' : 'bg-down-soft border-down-soft';

  // 도넛 차트는 conic-gradient 한 줄로 그린다. 조각 사이에 아주 얇은 흰 틈을 넣어
  // 비중이 비슷한 조각끼리 붙어 보이지 않게 한다.
  const currentChartGradient = useMemo(() => {
    if (currentChartData.length === 0) return 'conic-gradient(#e2e8f0 0% 100%)';

    const hasMultipleSlices = currentChartData.length > 1;
    return `conic-gradient(${currentChartData.flatMap((item) => {
      const start = Math.max(0, item.startPercent);
      const end = Math.min(100, item.startPercent + item.percent);
      const gap = hasMultipleSlices ? Math.min(0.07, item.percent * 0.08) : 0;
      const colorEnd = Math.max(start, end - gap);
      const colorSlice = `${item.color} ${start.toFixed(3)}% ${colorEnd.toFixed(3)}%`;
      if (gap <= 0.02 || colorEnd >= end) return [colorSlice];
      return [colorSlice, `rgba(255,255,255,0.58) ${colorEnd.toFixed(3)}% ${end.toFixed(3)}%`];
    }).join(', ')})`;
  }, [currentChartData]);

  // 도넛의 어느 조각을 눌렀는지는 클릭 좌표의 각도로 되돌려 찾는다.
  const handleChartRingClick = (event) => {
    if (selectedCategory || currentChartData.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = event.clientX - centerX;
    const deltaY = event.clientY - centerY;
    const percent = (((Math.atan2(deltaY, deltaX) * 180) / Math.PI + 90 + 360) % 360) / 3.6;
    const clickedItem = currentChartData.find((item) => (
      percent >= item.startPercent && percent <= item.startPercent + item.percent
    ));

    if (clickedItem) setSelectedCategory(clickedItem.name);
  };

  return (
      <div className="space-y-5 anim-fade">
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
          {/* 히어로 — 총 평가금액 */}
          <div className="bg-surface rounded-[20px] p-6 lg:p-7 flex flex-col justify-center">
            <p className="text-[14px] font-semibold text-ink-mute">총 평가금액</p>
            <p className="mt-2 figure text-[32px] lg:text-[38px] font-bold text-ink leading-none tnum">
              {formatMoney(totalConvertedKRW, 'KRW')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[14px] font-bold tnum ${
                  dashboardSummary.totalReturnPercent >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'
                }`}
              >
                {dashboardSummary.totalReturnPercent >= 0
                  ? <TrendingUp size={14} aria-hidden="true" />
                  : <TrendingDown size={14} aria-hidden="true" />}
                {dashboardSummary.totalReturnPercent > 0 ? '+' : ''}
                {dashboardSummary.totalReturnPercent.toFixed(2)}%
              </span>
              <span className={`text-[14px] font-semibold tnum ${dashboardSummary.evaluationProfitKRW >= 0 ? 'text-up' : 'text-down'}`}>
                {dashboardSummary.evaluationProfitKRW > 0 ? '+' : ''}
                {formatMoney(dashboardSummary.evaluationProfitKRW, 'KRW')}
              </span>
              <span className="text-[13px] font-medium text-ink-mute">
                · 국내/해외 주식 기준
              </span>
            </div>
          </div>

          {/* 보조 지표 3개 — 390px에서 3칸으로 쪼개면 금액이 칸을 넘쳐
              숫자 중간에서 줄바꿈된다(₩1,912,0 / 89). 좁을 땐 한 칸씩 쌓는다. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                label: '보유 자산',
                value: `${portfolioAssets.length.toLocaleString()}개`,
                tone: 'text-ink',
                helper: '등록된 주식 수',
              },
              {
                label: '실현손익',
                value: `${totalConvertedNetProfit > 0 ? '+' : ''}${formatMoney(totalConvertedNetProfit, 'KRW')}`,
                tone: totalConvertedNetProfit >= 0 ? 'text-up' : 'text-down',
                helper: '매수·매도 시점 환율 기준',
              },
              {
                label: '배당 수익',
                value: dividendCurrencyParts.length > 0 ? dividendCurrencyParts.join(' / ') : formatMoney(0, 'KRW'),
                tone: dashboardSummary.dividendKRW >= 0 ? 'text-ink' : 'text-down',
                helper: '실제 입금 + 지급 완료 계산분',
              },
            ].map((item) => (
              <div key={item.label} className="bg-surface rounded-[20px] p-4 lg:p-5 flex flex-col justify-center">
                <p className="text-[13px] font-semibold text-ink-mute">{item.label}</p>
                <p className={`mt-1.5 figure text-[17px] lg:text-[20px] font-bold leading-tight tnum ${item.tone}`}>
                  {item.value}
                </p>
                <p className="mt-1.5 text-[12px] font-medium text-ink-mute">{item.helper}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem] gap-4 lg:gap-5">
        {/* SVG 드릴다운 차트 — h-full로 두면 왼쪽 자산 표 높이만큼 늘어나
            아래쪽 절반 이상이 빈 채로 남는다. 내용 높이만 차지하게 두고
            데스크톱에서는 표를 스크롤하는 동안 계속 보이도록 붙여 둔다. */}
        <div className="order-2 lg:order-2 bg-surface p-6 lg:p-7 rounded-[20px] flex flex-col items-center lg:sticky lg:top-4 lg:self-start">
          <div className="w-full flex justify-between items-center mb-5 lg:mb-5">
            <h2 className="text-base lg:text-[16px] font-bold text-ink flex items-center gap-2"><PieIcon className="text-ink-soft" size={18}/> {selectedCategory ? `${selectedCategory}` : '자산 비중'}</h2>
            {selectedCategory && (
              <button onClick={() => setSelectedCategory(null)} className="text-[11px] md:text-[12px] font-bold text-ink-soft bg-line-soft px-2 py-1 md:px-3 md:py-1.5 rounded-full flex items-center gap-1 hover:bg-line"><ArrowLeft size={10} /> 메인으로</button>
            )}
          </div>
          {portfolioAssets.length === 0 ? (
            <div className="w-full min-h-72 md:min-h-80 flex flex-col items-center justify-center text-center px-3">
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-line-soft text-ink-soft flex items-center justify-center mb-4 md:mb-5">
                <Target size={24} className="md:w-7 md:h-7" />
              </div>
              <p className="text-base md:text-lg font-bold text-ink">첫 자산을 추가해보세요</p>
              <p className="mt-2 text-xs md:text-sm font-medium text-ink-mute leading-relaxed max-w-xs">
                국내주식이나 해외주식을 등록하면 비중, 수익률, 배당 기록이 이 화면에 바로 쌓입니다.
              </p>
              <button
                onClick={() => {
                  setIsAdding(true);
                }}
                className="mt-6 inline-flex items-center gap-2 h-12 px-5 bg-brand text-surface rounded-2xl text-[15px] font-bold hover:bg-brand-strong active:scale-[0.99] transition-all"
              >
                <Plus size={16} /> 자산 추가
              </button>
            </div>
          ) : (
  		                <div className="relative w-64 h-64 lg:w-80 lg:h-80 xl:w-88 xl:h-88">
              <div
                className={`absolute inset-0 rounded-full transition-all duration-700 ${!selectedCategory ? 'cursor-pointer hover:opacity-90' : 'opacity-95'}`}
                style={{ background: currentChartGradient }}
                onClick={handleChartRingClick}
                /*
                 * 링은 클릭 좌표로 분류를 고르므로 키 이벤트에는 구조적으로
                 * 반응할 수 없다. role="button" + tabIndex만 달아두면 포커스는
                 * 가는데 Enter를 눌러도 아무 일이 없는 '죽은 정거장'이 된다.
                 * 같은 선택을 아래 범례의 진짜 버튼들이 이미 제공하므로,
                 * 링은 마우스 편의 장치로만 두고 보조기술에는 숨긴다.
                 */
                aria-hidden="true"
              />
              <div className="absolute inset-[12%] rounded-full bg-surface shadow-inner shadow-line" />
  	                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-4 lg:p-6">
  	                    <span className="text-[11px] md:text-[12px] text-ink-mute font-bold tracking-[0.06em] mb-1">{selectedCategory ? `${selectedCategory}` : 'Total'}</span>
  	                    <div className="flex flex-col items-center gap-0.5">
  	                      {currentCategoryKRW > 0 && <span className="text-base md:text-lg lg:text-[clamp(1rem,1.35vw,1.35rem)] font-bold text-ink tracking-tight whitespace-nowrap">{formatMoney(currentCategoryKRW, 'KRW')}</span>}
  	                      {/* 원화분과 달러분은 서로 더할 수 없는 값이다. '+'로 이으면
  	                          둘을 합친 수식처럼 읽히므로 구분선으로 나눈다. */}
  	                      {currentCategoryKRW > 0 && currentCategoryUSD > 0 && <span className="w-8 border-t border-line-soft my-0.5" aria-hidden="true" />}
  	                      {currentCategoryUSD > 0 && <span className="text-base md:text-lg lg:text-[clamp(1rem,1.35vw,1.35rem)] font-bold text-ink tracking-tight whitespace-nowrap">{formatMoney(currentCategoryUSD, 'USD')}</span>}
  	                    </div>
                {isDomesticStockChart ? (
  	                      <div className={`mt-2 md:mt-3 max-w-[82%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${profitBgTone}`}>
                    <span className="text-[11px] md:text-[11px] font-bold text-ink-mute">총 수익금액</span>
                    <span className={`text-[12px] md:text-[13px] font-bold ${profitTone}`}>
                      {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                    </span>
                  </div>
                ) : isOverseasStockChart ? (
  	                      <div className={`mt-2 md:mt-3 max-w-[82%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${currentCategoryProfitUSD >= 0 ? 'bg-up-soft border-up-soft' : 'bg-down-soft border-down-soft'}`}>
                    <span className="text-[11px] md:text-[11px] font-bold text-ink-mute">총 수익금액</span>
                    <span className={`text-[12px] md:text-[13px] font-bold ${currentCategoryProfitUSD >= 0 ? 'text-up' : 'text-down'}`}>
                      {currentCategoryProfitUSD > 0 ? '+' : ''}{formatMoney(currentCategoryProfitUSD, 'USD')}
                    </span>
                  </div>
                ) : (
                  <>
  	                        <div className="mt-2 md:mt-3 max-w-[86%] bg-canvas px-2 py-1 md:px-3 md:py-1.5 rounded-full flex items-center justify-center gap-1.5">
  	                          <span className="text-[11px] md:text-[11px] font-bold text-ink-mute whitespace-nowrap">총 평가가치</span>
  	                          <span className="text-[12px] md:text-[13px] lg:text-[13px] font-bold text-ink-soft whitespace-nowrap">{formatMoney(currentCategoryTotalConverted, 'KRW')}</span>
  	                        </div>
  	                        <div className={`mt-1.5 max-w-[86%] px-2 py-1 md:px-3 md:py-1.5 rounded-full border flex items-center justify-center gap-1.5 ${profitBgTone}`}>
  	                          <span className="text-[11px] md:text-[11px] font-bold text-ink-mute whitespace-nowrap">총 수익금액</span>
  	                          <span className={`text-[12px] md:text-[13px] font-bold ${profitTone}`}>
                        {currentCategoryProfitKRW > 0 ? '+' : ''}{formatMoney(currentCategoryProfitKRW, 'KRW')}
                      </span>
                      {isOverseasStockChart && currentCategoryProfitUSD !== 0 && (
                        <span className={`text-[12px] md:text-[13px] font-bold ${profitTone}`}>
                          / {currentCategoryProfitUSD > 0 ? '+' : ''}{formatMoney(currentCategoryProfitUSD, 'USD')}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="mt-6 lg:mt-6 w-full space-y-1.5">
            {currentChartData.map(data => (
              <button key={data.id || data.name} onClick={() => !selectedCategory && setSelectedCategory(data.name)} className={`w-full flex items-center justify-between p-3 lg:px-3 lg:py-2.5 rounded-xl border transition-all ${!selectedCategory ? 'bg-canvas border-line hover:bg-surface hover:border-line' : 'bg-surface border-line'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shadow-inner" style={{ backgroundColor: data.color }}></div>
                  <span className="text-[13px] md:text-xs font-bold text-ink-soft">{data.name}</span>
                </div>
                <span className="text-[12px] md:text-[13px] font-bold text-ink-mute">{data.percent.toFixed(1)}%</span>
              </button>
            ))}
          </div>
        </div>

        {/* List 섹션 */}
        <div className="order-1 lg:order-1 space-y-6 min-w-0">
          <div className="bg-surface rounded-[20px] overflow-hidden">
            <div className="p-5 lg:px-5 lg:py-4 border-b border-line flex justify-between items-center bg-surface">
              <h3 className="text-base lg:text-[16px] font-bold text-ink">{selectedCategory ? `${selectedCategory} 상세 목록` : '보유 자산 상세'}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left">
                <thead className="hidden md:table-header-group">
                  <tr className="text-ink-mute text-[11px] md:text-[12px] font-bold tracking-[0.06em] border-b border-line bg-canvas/50">
                    <th className="px-4 py-3 md:px-5 md:py-3.5 w-[30%]">종목/자산</th>
                    <th className="px-4 py-3 md:px-5 md:py-3.5 w-[38%]">상세 가치</th>
                    <th className="px-4 py-3 md:px-4 md:py-3.5 text-right w-[20%]">수익률</th>
                    <th className="px-4 py-3 md:px-3 md:py-3.5 text-center w-[12%]">관리</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group divide-y divide-line-soft">
                  {visibleDetailAssets.map((asset) => {
                    // 해외(외화) 종목은 행마다 $ / ₩ 를 눌러 바꿔 볼 수 있다.
                    const nativeCurrency = asset.originalCurrency || asset.currency || 'KRW';
                    const canToggleCurrency = nativeCurrency !== 'KRW';
                    const isKrwView = canToggleCurrency && assetCurrencyView[asset.id] === 'KRW';
                    const viewCurrency = isKrwView ? 'KRW' : nativeCurrency;
                    const rate = Number(asset.krwRate) > 0 ? Number(asset.krwRate) : 1;
                    const todayRate = Number(asset.todayKrwRate) > 0 ? Number(asset.todayKrwRate) : rate;
                    const nativeAveragePrice = asset.nativeAveragePrice
                      || Number(asset.originalAveragePrice)
                      || Number(asset.averagePrice)
                      || 0;

                    /**
                     * ₩ 보기는 증권사 앱과 같은 기준이다.
                     * 원금은 매수 시점 환율로 실제 낸 원화, 평가금액은 오늘 환율.
                     * 그래서 손익에 환차손익이 함께 들어간다.
                     * $ 보기는 환율을 걷어낸 순수 주가 손익만 보여준다.
                     */
                    const view = isKrwView
                      ? {
                        purchase: asset.purchaseKRW,
                        averagePrice: asset.krwAveragePrice,
                        current: asset.currentKRW,
                        price: asset.nativeCurrentPrice * todayRate,
                        profit: asset.profitKRW,
                        returnPercent: asset.returnPercentKRW,
                      }
                      : {
                        purchase: asset.purchaseNative,
                        averagePrice: nativeAveragePrice,
                        current: asset.currentNative,
                        price: asset.nativeCurrentPrice,
                        profit: asset.profitNative,
                        returnPercent: asset.returnPercent,
                      };
                    // 매수 시점 환율을 다 모르면 원금이 오늘 환율로 환산된 근사값이다.
                    const isApproxKrwPrincipal = isKrwView && asset.purchaseKRWSource === 'today-rate';

                    return (
                    <tr key={asset.id} className="block md:table-row px-4 py-5 md:p-0 hover:bg-canvas/60 transition-all group">
                      <td className="block md:table-cell px-0 py-0 md:px-5 md:py-4 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-2xl md:rounded-xl flex items-center justify-center text-surface font-bold text-xl md:text-lg shadow-sm group-hover:scale-[1.02] transition-transform" style={{ backgroundColor: asset.color }}>
                            {asset.name[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-ink text-base md:text-[16px] leading-none truncate">{asset.name}</p>
                            <p className="text-xs md:text-[13px] text-ink-mute font-bold mt-2 md:mt-1.5 truncate">
                              {asset.ticker} • {formatAssetQuantity(asset.quantity, asset.category)}주
                            </p>
                            <p className="text-[12px] md:text-[13px] text-ink-mute font-bold mt-1 whitespace-nowrap">
                              최초 매수일 {asset.displayBuyDate || asset.buyDate || '-'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="block md:table-cell px-0 py-4 md:px-5 md:py-4 align-middle">
                        {canToggleCurrency && (
                          <div className="flex items-center justify-end gap-1 mb-2 px-4 md:px-0">
                            <div className="seg inline-flex items-center p-0.5 rounded-[10px]" role="group" aria-label="통화 전환">
                              {[
                                { key: 'NATIVE', label: nativeCurrency === 'JPY' ? '¥' : '$' },
                                { key: 'KRW', label: '₩' },
                              ].map((option) => {
                                const active = option.key === 'KRW' ? isKrwView : !isKrwView;
                                return (
                                  <button
                                    key={option.key}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAssetCurrencyView(prev => ({ ...prev, [asset.id]: option.key }));
                                    }}
                                    aria-pressed={active}
                                    title={option.key === 'KRW' ? '원화로 보기' : '현지 통화로 보기'}
                                    className={`seg-item px-2.5 py-1 rounded-lg text-[12px] md:text-[13px] font-bold leading-none ${
                                      active ? 'text-ink' : 'text-ink-mute hover:text-ink-soft'
                                    }`}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 md:gap-x-5 gap-y-3 md:gap-y-1.5 bg-canvas/80 md:bg-transparent px-4 py-3.5 md:p-0 rounded-xl md:rounded-none group-transition-colors w-full min-w-0">
                          <div className="flex flex-col">
                            <span className="text-[11px] md:text-[11px] text-ink-mute font-bold whitespace-nowrap overflow-hidden text-ellipsis">
                              총 매입
                              {isKrwView && asset.purchaseKRWSource === 'manual' && ' · 직접 입력'}
                              {isApproxKrwPrincipal && ' · 오늘 환율'}
                            </span>
                            <span className="font-bold text-ink-soft text-xs md:text-[14px] mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.purchase, viewCurrency)}</span>
                          </div>
                          <div className="flex flex-col text-right">
                            <span className="text-[11px] md:text-[11px] text-ink-mute font-bold">평단가</span>
                            <span className="font-bold text-ink-soft text-xs md:text-[14px] mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.averagePrice, viewCurrency)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[11px] md:text-[11px] text-ink-soft font-bold">총 가치</span>
                            <span className="font-bold text-ink text-xs md:text-[14px] mt-1 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.current, viewCurrency)}</span>
                          </div>
                          <div className="flex flex-col text-right">
                            <span className="text-[11px] md:text-[11px] text-ink-soft font-bold">현재가</span>
                            <span className="font-bold text-ink text-xs md:text-[14px] mt-1 leading-none whitespace-nowrap overflow-hidden text-ellipsis">{formatMoney(view.price, viewCurrency)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="block md:table-cell px-0 pb-4 md:px-4 md:py-4 text-left md:text-right whitespace-nowrap align-middle">
                        <div className="flex flex-row md:flex-col items-stretch md:items-end gap-2">
                          <div className={`inline-flex items-center justify-center gap-1.5 flex-1 md:flex-none md:w-full px-2 md:px-2.5 py-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[14px] font-bold ${view.returnPercent >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                            {view.returnPercent >= 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} {Math.abs(view.returnPercent).toFixed(2)}%
                          </div>
                          <div className={`inline-flex items-center justify-center flex-1 md:flex-none md:w-full px-2 md:px-2.5 py-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[14px] font-bold ${view.profit >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
                            {view.profit > 0 ? '+' : ''}{formatMoney(view.profit, viewCurrency)}
                          </div>
                        </div>
                      </td>
                      <td className="block md:table-cell px-0 py-0 md:px-3 md:py-4 text-right md:text-center whitespace-nowrap align-middle">
                      {/* 예전에는 데스크톱에서 라벨을 숨기고 아이콘만 세로로 쌓았다.
                          무슨 버튼인지 알 수 없었고, 세로 스택이 행 높이를 240px까지
                          밀어올려 표가 통째로 길어졌다. 모바일과 같은 라벨 버튼을 쓴다. */}
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAddBuyModal(asset);
                          }}
                          className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-ink hover:bg-line-soft transition-colors px-2 py-1.5 rounded-lg text-[13px] md:text-[12px] font-bold"
                          title="추가 매수"
                        >
                          <Plus size={16} className="md:w-4.5 md:h-4.5" />
                          <span>추가 매수</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openSellModal(asset);
                          }}
                          className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-warn hover:bg-warn-soft transition-colors px-2 py-1.5 rounded-lg text-[13px] md:text-[12px] font-bold"
                          title="일부 매도"
                        >
                          <Minus size={16} className="md:w-4.5 md:h-4.5" />
                          <span>일부 매도</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openBuyLotsModal(asset);
                          }}
                          className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-brand hover:bg-brand-soft transition-colors px-2 py-1.5 rounded-lg text-[13px] md:text-[12px] font-bold"
                          title="매수 기록 관리"
                        >
                          <CalendarDays size={16} className="md:w-4.5 md:h-4.5" />
                          <span>매수 기록</span>
                        </button>

                        {canSummarizeAsset(asset) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInsightAsset(asset);
                            }}
                            className="inline-flex items-center justify-center gap-1.5 text-ink-soft hover:text-brand hover:bg-brand-soft transition-colors px-2 py-1.5 rounded-lg text-[13px] md:text-[12px] font-bold"
                            title="AI 요약"
                          >
                            <Sparkles size={16} className="md:w-4.5 md:h-4.5" />
                            <span>AI 요약</span>
                          </button>
                        )}

                        <button
                          onClick={(e) => requestRemoveAsset(asset.id, e)}
                          className="inline-flex items-center justify-center gap-1.5 text-ink-mute hover:text-danger hover:bg-danger-soft transition-colors px-2 py-1.5 rounded-lg text-[13px] md:text-[12px] font-bold"
                          title="자산 삭제"
                        >
                          <Trash2 size={16} className="md:w-4.5 md:h-4.5" />
                          <span className="sr-only">자산 삭제</span>
                        </button>
                      </div>
                    </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleDetailAssets.length === 0 && (
                <div className="p-6 md:p-12 text-center">
                  <div className="mx-auto w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-canvas text-ink-mute flex items-center justify-center mb-4">
                    <Wallet size={24} />
                  </div>
                  <p className="text-ink font-bold text-sm md:text-base">아직 등록된 주식이 없습니다.</p>
                  <p className="mt-2 text-ink-mute font-medium text-xs md:text-sm">국내주식이나 해외주식을 추가하면 상세 가치와 수익률이 표시됩니다.</p>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
  );
};

export default PortfolioTab;
