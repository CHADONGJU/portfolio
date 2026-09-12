// 자산 삭제 확인 모달.
// 자산을 지우면 연결된 매매 기록·메모·원장까지 함께 사라지고 되돌릴 수 없다.
// 무엇이 몇 건 지워지는지 먼저 보여준 뒤 확인을 받는다. 배당 내역은 통계를
// 위해 남기므로 그 사실도 함께 알린다.
import { Trash2 } from 'lucide-react';

const RemoveAssetConfirmModal = ({ pendingRemoval, onCancel, onConfirm }) => {
  if (!pendingRemoval) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4 anim-fade"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-asset-title"
        className="w-full max-w-105 bg-surface rounded-3xl p-7 shadow-modal anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-11 h-11 rounded-2xl bg-danger-soft text-danger flex items-center justify-center mb-4">
          <Trash2 size={20} aria-hidden="true" />
        </div>
        <h2 id="remove-asset-title" className="text-base md:text-lg font-bold text-ink">
          [{pendingRemoval.asset.name}] 자산을 삭제할까요?
        </h2>
        <p className="mt-2 text-xs md:text-sm font-medium text-ink-soft leading-relaxed">
          아래 기록이 함께 삭제되며 되돌릴 수 없습니다.
        </p>

        <ul className="mt-4 space-y-1.5 bg-canvas rounded-2xl p-4">
          {[
            { label: '매매 기록', count: pendingRemoval.tradeCount },
            { label: '메모', count: pendingRemoval.memoCount },
            { label: '매매 원장', count: pendingRemoval.ledgerCount },
          ].map(({ label, count }) => (
            <li key={label} className="flex items-center justify-between text-xs md:text-sm">
              <span className="font-bold text-ink-soft">{label}</span>
              <span className="font-bold text-ink">{count.toLocaleString()}건</span>
            </li>
          ))}
        </ul>

        {pendingRemoval.dividendCount > 0 && (
          <p className="mt-3 text-[13px] md:text-xs font-bold text-ink-mute">
            배당 내역 {pendingRemoval.dividendCount.toLocaleString()}건은 통계를 위해 유지됩니다.
          </p>
        )}

        <div className="mt-6 flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 px-5 py-3 min-h-11 bg-line-soft text-ink-soft rounded-xl md:rounded-2xl font-bold text-xs md:text-sm hover:bg-line transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-5 py-3 min-h-11 bg-danger text-surface rounded-xl md:rounded-2xl font-bold text-xs md:text-sm hover:bg-danger transition-colors"
          >
            삭제하기
          </button>
        </div>
      </div>
    </div>
  );
};

export default RemoveAssetConfirmModal;
