import { ArrowLeft } from 'lucide-react';
import { formatMoney } from '../utils/formatters.js';

const TargetPortfolioCharts = ({ selectedTargetGroupGuide, selectedTargetGuide, targetCurrentDrilldownChartData, targetCurrentChartData, totalConvertedKRW, targetDrilldownChartData, targetGoalChartData, targetBudgetKRW, setSelectedTargetGroup, setSelectedTargetCategory }) => (<>
          {(
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
                      ? `${selectedTargetGuide.id} 목표 구성`
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
                        <ArrowLeft size={12} /> {selectedTargetGroupGuide ? '종목 묶음' : '전체 목표'}
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

</>);

export default TargetPortfolioCharts;
