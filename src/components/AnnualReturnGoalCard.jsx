import { ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { formatInputNumber, sanitizeNumericInput } from '../utils/formatters.js';

const AnnualReturnGoalCard = ({ year, targetPercent, performance, onTargetChange, onYearChange, onOpenAccountManager }) => {
  const currentYear = new Date().getFullYear();
  const actual = Number.isFinite(performance?.returnPercent) ? performance.returnPercent : null;
  const target = Number(targetPercent) || 0;
  const min = Math.min(0, actual ?? 0);
  const max = Math.max(1, target, actual ?? 0);
  const range = max - min || 1;
  const zeroPosition = ((0 - min) / range) * 100;
  const actualPosition = actual === null ? zeroPosition : ((actual - min) / range) * 100;
  const targetPosition = ((target - min) / range) * 100;
  const fillLeft = Math.min(zeroPosition, actualPosition);
  const fillWidth = Math.abs(actualPosition - zeroPosition);
  const currentReturnLabel = performance?.periodType === 'since-first-deposit'
    ? (performance?.joinedAtAnchored ? '가입 이후 수익률' : '첫 입금 이후 수익률')
    : performance?.periodType === 'recorded-period'
      ? '기록 시작 이후 수익률'
      : '현재 수익률';
  const carriedForwardAmount = Number.isFinite(performance?.carriedForwardValueKRW)
    ? performance.carriedForwardValueKRW.toLocaleString('ko-KR')
    : null;
  const achievementPercent = target > 0 && actual !== null
    ? Math.max(0, Math.round((actual / target) * 100))
    : null;
  const statusMessage = achievementPercent !== null
    ? `달성률 ${achievementPercent}%`
    : target <= 0
      ? '목표 수익률을 입력하세요.'
      : '첫 입금 기록 또는 과거 기준값이 필요합니다.';
  const insufficientMessage = performance?.reason === 'cash-flow-required'
    ? '첫 입금 기록을 추가하면 현재 평가액과 연결해 자동 계산합니다.'
    : performance?.reason === 'current-value-required'
      ? '입금 기록은 확인됐습니다. 현재 보유 자산의 평가액이 준비되면 자동 계산합니다.'
      : performance?.reason === 'opening-value-required'
        ? '기록이 출금부터 시작되어 초기 자산을 알 수 없습니다. 해당 연도 시작 기준 평가액만 입력하세요.'
        : performance?.reason === 'capital-base-required'
          ? '이 기간 순입금(입금-출금)이 0원 이하라 나눌 원금 기준이 없어 수익률을 표시할 수 없습니다.'
          : '입출금 기록과 현재 평가액으로 자동 계산합니다. 이미 투자 중인 상태에서 기록을 시작했다면 해당 연도 시작 기준 평가액만 선택적으로 입력하세요.';

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-ink-soft" />
          <div>
            <h3 className="text-base md:text-lg font-bold text-ink">{year}년 목표 수익률</h3>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1">목표와 실제 연도별 수익률을 이 화면에서 함께 관리합니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <div className="seg inline-flex items-center p-1 rounded-xl">
            <button type="button" onClick={() => onYearChange(year - 1)} aria-label="목표 이전 연도" className="seg-item w-9 h-9 grid place-items-center rounded-lg text-ink-mute hover:text-ink"><ChevronLeft size={15} /></button>
            <span className="px-2 text-xs font-bold text-ink">{year}</span>
            <button type="button" onClick={() => onYearChange(year + 1)} disabled={year >= currentYear} aria-label="목표 다음 연도" className="seg-item w-9 h-9 grid place-items-center rounded-lg text-ink-mute hover:text-ink disabled:opacity-30"><ChevronRight size={15} /></button>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink-mute">목표</span>
            <span className="relative">
              <input inputMode="decimal" value={formatInputNumber(targetPercent)} onChange={(event) => onTargetChange(sanitizeNumericInput(event.target.value))} placeholder="10" className="w-28 h-11 pl-4 pr-8 bg-canvas rounded-xl text-right text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-brand" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-mute">%</span>
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
        {performance?.status === 'ready' && performance.inferredStart && (
          <div className="mb-5 rounded-2xl bg-up-soft px-4 py-3">
            <p className="text-xs font-bold text-up leading-relaxed">
              {performance.joinedAtAnchored
                ? `가입일 ${performance.startDate}을 시작점(0원)으로, 가입 이전 포트폴리오는 가정하지 않고 계산했습니다.`
                : `1월 1일 평가액 없이 첫 입금일 ${performance.startDate}을 시작점(0원)으로 자동 계산했습니다.`}
            </p>
          </div>
        )}
        {performance?.status === 'ready' && performance.carriedForward && (
          <div className="mb-5 rounded-2xl bg-up-soft px-4 py-3">
            <p className="text-xs font-bold text-up leading-relaxed">전년도 마지막 평가액인 {performance.carriedForwardAsOfDate}자 {carriedForwardAmount}원을 {year}년 시작 기준으로 이어받아 계산했습니다.</p>
          </div>
        )}
        {actual === null && (
          <div className="mb-5 rounded-2xl bg-warn-soft px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs font-bold text-warn leading-relaxed">{insufficientMessage}</p>
            {onOpenAccountManager && <button type="button" onClick={onOpenAccountManager} className="shrink-0 px-3 py-2 rounded-xl bg-surface text-xs font-bold text-ink">계좌 관리 열기</button>}
          </div>
        )}
        <div className="relative h-5 rounded-full bg-line-soft overflow-visible">
          <span className="absolute top-0 h-full w-px bg-ink/40" style={{ left: `${zeroPosition}%` }} />
          {actual !== null && <span className={`absolute top-0 h-full rounded-full ${actual >= 0 ? 'bg-up' : 'bg-down'}`} style={{ left: `${fillLeft}%`, width: `${Math.max(fillWidth, 0.8)}%` }} />}
          {target > 0 && <span className="absolute -top-2 h-9 w-0.5 bg-ink rounded-full" style={{ left: `${targetPosition}%` }} title={`목표 ${target}%`} />}
        </div>
        <div className="mt-3 flex justify-between text-[11px] font-bold text-ink-mute"><span>{min.toFixed(1)}%</span><span>목표 {target > 0 ? `${target}%` : '미설정'}</span></div>
      </div>
    </section>
  );
};

export default AnnualReturnGoalCard;
