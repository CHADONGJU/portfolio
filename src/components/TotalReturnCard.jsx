import { Activity, AlertCircle } from 'lucide-react';

const reasonMessage = (performance) => {
  if (performance?.reason === 'fx-rate-missing') return '입출금 환율 확인 필요';
  if (performance?.reason === 'daily-snapshot-missing') {
    const count = performance.missingSnapshotDates?.length || 0;
    return `Daily Snapshot ${count.toLocaleString()}일 복원 필요`;
  }
  if (performance?.reason === 'second-snapshot-required') return '다음 Daily Snapshot 대기 중';
  if (performance?.reason === 'snapshot-required') return 'Daily Snapshot 생성 대기 중';
  if (performance?.reason === 'twr-available-from-required') return '초기 Snapshot 확정 필요';
  return '계산에 필요한 평가 기록 준비 중';
};

const formatDate = (date) => String(date || '').replaceAll('-', '.');

const TotalReturnCard = ({
  performance,
  lastCashFlowDate,
  hasInitializingSnapshot = false,
  onCompleteInitialSetup,
}) => {
  const ready = performance?.status === 'ready';
  const fullAccountHistory = ready && performance?.fullAccountHistory;
  const value = Number(performance?.returnPercent) || 0;

  return (
    <div className="bg-surface rounded-[20px] p-4 lg:p-5 flex flex-col justify-center">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-mute">
        {ready ? <Activity size={14} /> : <AlertCircle size={14} />}
        {fullAccountHistory ? '총수익률 (TWR)' : '기록 구간 TWR'}
      </div>
      {ready ? (
        <>
          <p className={`mt-1.5 figure text-[20px] lg:text-[24px] font-bold leading-tight ${value >= 0 ? 'text-up' : 'text-down'}`}>
            {value > 0 ? '+' : ''}{value.toFixed(2)}%
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-ink-mute">
            Daily TWR · 기준일 {formatDate(performance?.baselineDate || performance?.twrAvailableFrom || performance?.startDate)}
          </p>
          <p className="mt-1 text-[11px] font-medium text-ink-mute">
            {!fullAccountHistory && performance?.accountInceptionDate
              ? `계좌 최초 활동 ${formatDate(performance.accountInceptionDate)} · TWR 계산 가능 ${formatDate(performance.twrAvailableFrom)}부터`
              : (lastCashFlowDate ? `입출금 업데이트 ${formatDate(lastCashFlowDate)}` : '반영된 외부 입출금 없음')}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[15px] lg:text-[16px] font-bold leading-tight text-ink">
            {reasonMessage(performance)}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-ink-mute">
            {performance?.twrAvailableFrom
              ? `계산 가능 시작일 ${formatDate(performance.twrAvailableFrom)}`
              : (lastCashFlowDate ? `입출금 업데이트 ${formatDate(lastCashFlowDate)}` : '정상 평가 기록 대기 중')}
          </p>
          {hasInitializingSnapshot && onCompleteInitialSetup && (
            <button
              type="button"
              onClick={onCompleteInitialSetup}
              className="mt-3 self-start rounded-xl bg-brand px-3 py-2 text-[11px] font-bold text-white"
            >
              초기 포트폴리오 설정 완료
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default TotalReturnCard;
