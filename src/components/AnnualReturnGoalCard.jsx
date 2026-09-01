import { ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters.js';

const AnnualReturnGoalCard = ({ year, earliestYear, targetPercent, performance, onTargetChange, onYearChange }) => {
  const currentYear = new Date().getFullYear();
  const actual = Number.isFinite(performance?.returnPercent) ? performance.returnPercent : null;
  const target = Number(targetPercent) || 0;
  const min = Math.min(0, actual ?? 0);
  const max = Math.max(1, target, actual ?? 0);
  const range = max - min || 1;
  const zeroPosition = ((0 - min) / range) * 100;
  const actualPosition = actual === null ? zeroPosition : ((actual - min) / range) * 100;
  const fillLeft = Math.min(zeroPosition, actualPosition);
  const fillWidth = Math.abs(actualPosition - zeroPosition);
  const currentReturnLabel = performance?.periodType === 'since-first-deposit'
    ? (performance?.joinedAtAnchored ? '가입 이후 수익률' : '첫 입금 이후 수익률')
    : performance?.periodType === 'recorded-period'
      ? '기록 시작 이후 수익률'
      : performance?.periodType === 'since-signup-twr'
        ? '가입 이후 Daily TWR'
        : performance?.periodType === 'recorded-period-twr'
          ? `${performance?.startDate || '기록 시작일'} 이후 Daily TWR`
          : performance?.periodType === 'calendar-year-twr'
            ? '연간 Daily TWR'
            : '현재 수익률';
  const carriedForwardAmount = Number.isFinite(performance?.carriedForwardValueKRW)
    ? performance.carriedForwardValueKRW.toLocaleString('ko-KR')
    : null;
  const achievementPercent = target > 0 && actual !== null
    ? Math.max(0, (actual / target) * 100)
    : null;
  const achievementLabel = achievementPercent === null
    ? null
    : Number.isInteger(achievementPercent)
      ? `${achievementPercent}`
      : achievementPercent.toFixed(1);
  const statusMessage = achievementLabel !== null
    ? `달성률 ${achievementLabel}%`
    : target <= 0
      ? '목표 수익률을 입력하세요.'
      : '첫 입금 기록 또는 과거 기준값이 필요합니다.';
  const insufficientMessage = performance?.reason === 'cash-flow-required'
    ? '첫 입금 기록을 추가하면 현재 평가액과 연결해 자동 계산합니다.'
    : performance?.reason === 'current-value-required'
      ? '입금 기록은 확인됐습니다. 현재 보유 자산의 평가액이 준비되면 자동 계산합니다.'
      : performance?.reason === 'opening-value-required'
        ? '기록이 출금부터 시작되어 이전 잔액을 알 수 없어 계산할 수 없습니다.'
        : performance?.reason === 'capital-base-required'
          ? '이 기간 순입금(입금-출금)이 0원 이하라 나눌 원금 기준이 없어 수익률을 표시할 수 없습니다.'
          : performance?.reason === 'daily-snapshot-missing'
            ? `Daily Snapshot ${performance.missingSnapshotDates?.length || 0}일을 복원해야 정확한 TWR을 표시할 수 있습니다.`
            : performance?.reason === 'snapshot-required'
              ? '가입일의 Daily Snapshot부터 복원이 필요합니다.'
              : performance?.reason === 'annual-opening-baseline-required'
                ? `${performance.requiredBaselineDate || '직전 연도 말'} EOD 기준 평가액이 있어야 해당 연도 전체 TWR을 계산할 수 있습니다.`
                : performance?.reason === 'second-snapshot-required'
                  ? '두 번째 Daily Snapshot이 생성된 뒤 계산할 수 있습니다.'
                  : performance?.reason === 'fx-rate-missing'
                    ? '외화 입출금의 과거 환율 확인이 필요합니다.'
                    : performance?.reason === 'before-twr-availability'
                      ? `${performance.twrAvailableFrom || '계산 가능 시작일'} 이전 연도는 정확한 TWR을 계산할 수 없습니다.`
                      : performance?.reason === 'twr-available-from-required'
                        ? '최초 정상 Portfolio Snapshot이 필요합니다.'
                        : '입출금 기록과 Daily Snapshot이 준비되면 자동 계산합니다.';

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-ink-soft" />
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink">{year}년 목표 수익률</h3>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">목표와 현금 포함 Daily TWR을 같은 기준으로 비교합니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <div className="seg inline-flex items-center p-1 rounded-xl">
            <button type="button" onClick={() => onYearChange(year - 1)} disabled={year <= earliestYear} aria-label="목표 이전 연도" className="seg-item w-9 h-9 grid place-items-center rounded-lg text-ink-mute hover:text-ink disabled:opacity-30"><ChevronLeft size={15} /></button>
            <span className="px-2 text-xs font-bold text-ink">{year}</span>
            <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= currentYear} aria-label="목표 다음 연도" className="seg-item w-9 h-9 grid place-items-center rounded-lg text-ink-mute hover:text-ink disabled:opacity-30"><ChevronRight size={15} /></button>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink-mute">목표</span>
            <span className="w-28 h-11 px-3 bg-canvas rounded-xl flex items-center justify-center gap-1 focus-within:ring-2 focus-within:ring-brand">
              <input inputMode="decimal" value={formatInputNumber(targetPercent)} onChange={(event) => onTargetChange(sanitizeNumericInput(event.target.value))} placeholder="10" className="min-w-0 flex-1 bg-transparent text-right text-sm font-bold text-ink outline-none" />
              <span className="shrink-0 text-xs font-bold text-ink-mute">%</span>
            </span>
          </label>
        </div>
      </div>
      <div className="p-5 md:p-7">
        <div className="flex items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-[11px] font-bold text-ink-mute">{currentReturnLabel}</p>
            <p className={`figure text-3xl font-bold mt-1 ${actual === null ? 'text-ink-mute' : actual >= 0 ? 'text-up' : 'text-down'}`}>{actual === null ? '계산 준비 중' : `${actual >= 0 ? '+' : ''}${actual.toFixed(2)}%`}</p>
          </div>
          <p className="text-xs md:text-sm font-bold text-ink-soft">{statusMessage}</p>
        </div>
        {performance?.status === 'ready' && performance.carriedForward && (
          <div className="mb-5 rounded-2xl bg-up-soft px-4 py-3">
            <p className="text-xs font-bold text-up leading-relaxed">전년도 마지막 평가액인 {performance.carriedForwardAsOfDate}자 {carriedForwardAmount}원을 {year}년 시작 기준으로 이어받아 계산했습니다.</p>
          </div>
        )}
        {performance?.status === 'ready' && performance.coverageStatus === 'partial' && (
          <div className="mb-5 rounded-2xl bg-warn-soft px-4 py-3">
            <p className="text-xs font-bold text-warn leading-relaxed">
              {performance.accountInceptionDate
                ? `계좌 최초 확인일은 ${performance.accountInceptionDate}이지만 ${performance.startDate} 이전은 정확한 Snapshot이 없어 계산하지 않습니다.`
                : `${performance.startDate} 이후의 정확한 기록 구간만 계산합니다.`}
            </p>
          </div>
        )}
        {actual === null && (
          <div className="mb-5 rounded-2xl bg-warn-soft px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs font-bold text-warn leading-relaxed">{insufficientMessage}</p>
          </div>
        )}
        <div className="relative h-5 rounded-full bg-line-soft overflow-hidden">
          {actual !== null && <span className={`absolute top-0 h-full rounded-full ${actual >= 0 ? 'bg-up' : 'bg-down'}`} style={{ left: `${fillLeft}%`, width: `${Math.max(fillWidth, 0.8)}%` }} />}
        </div>
        <div className="mt-3 flex justify-between text-[11px] font-bold text-ink-mute"><span>{min.toFixed(1)}%</span><span>목표 {target > 0 ? `${target}%` : '미설정'}</span></div>
      </div>
    </section>
  );
};

export default AnnualReturnGoalCard;
