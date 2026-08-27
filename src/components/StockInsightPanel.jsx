import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles, X } from 'lucide-react';
import { AiInsightError, fetchStockInsight, isAiInsightConfigured } from '../services/aiInsight';

const QUESTION_MAX_LENGTH = 300;

/**
 * 모델이 돌려주는 건 헤딩 없는 짧은 문단과 "- " 목록뿐이다(프롬프트에서 그렇게 제한한다).
 * 마크다운 파서를 통째로 들이는 대신 그 두 가지만 처리한다. 강조 별표는
 * 화면에 그대로 보이면 지저분하므로 걷어낸다.
 */
const renderInsightBlocks = (text) => {
  const blocks = [];
  let bullets = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push({ type: 'list', items: bullets });
    bullets = [];
  };

  String(text).split('\n').forEach((rawLine) => {
    const line = rawLine.replace(/\*\*/g, '').trimEnd();
    if (!line.trim()) {
      flushBullets();
      return;
    }
    const bulletMatch = /^\s*[-•*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      bullets.push(bulletMatch[1]);
      return;
    }
    flushBullets();
    blocks.push({ type: 'paragraph', text: line.trim() });
  });

  flushBullets();
  return blocks;
};

const StockInsightPanel = ({ asset, user, onClose }) => {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(null);

  /**
   * 모달이 닫히는데 요청이 살아 있으면, 이미 사라진 패널에 setState가 걸리고
   * 사용자는 쓰지도 않을 응답 한 건을 한도에서 날린다. 언마운트 시 끊는다.
   */
  useEffect(() => () => abortRef.current?.abort(), []);

  const runInsight = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchStockInsight({
        asset,
        question: question.trim(),
        user,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult(response);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof AiInsightError ? caught : new AiInsightError('알 수 없는 오류입니다.', 'unknown'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [asset, question, user]);

  const isDisabled = isLoading || !isAiInsightConfigured || !user;

  return (
    <div className="w-full md:max-w-2xl bg-surface rounded-t-[28px] md:rounded-[28px] overflow-hidden flex flex-col shadow-2xl max-h-[92vh] md:max-h-[88vh]">
      <div className="p-5 md:p-7 border-b border-line flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-brand-soft text-brand grid place-items-center shrink-0">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0">
            <h2 id="stock-insight-title" className="text-lg md:text-xl font-bold text-ink truncate">
              {asset?.name} AI 요약
            </h2>
            <p className="text-[11px] md:text-xs font-semibold text-ink-mute mt-1 truncate">
              {asset?.ticker || asset?.category || '보유 종목'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="AI 요약 닫기"
          className="w-10 h-10 rounded-xl bg-canvas text-ink-mute grid place-items-center hover:text-ink shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-5 md:p-7 space-y-4 overflow-y-auto grow">
        {!isAiInsightConfigured && (
          <p className="rounded-2xl bg-canvas p-5 text-sm font-semibold text-ink-mute">
            AI 프록시 주소(VITE_AI_PROXY_URL)가 설정되지 않았습니다.
          </p>
        )}

        {isAiInsightConfigured && !user && (
          <p className="rounded-2xl bg-canvas p-5 text-sm font-semibold text-ink-mute">
            AI 요약은 로그인 후 사용할 수 있습니다.
          </p>
        )}

        {error && (
          <div className="rounded-2xl bg-danger-soft p-5 flex items-start gap-3">
            <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-ink">{error.message}</p>
          </div>
        )}

        {isLoading && (
          <div className="rounded-2xl bg-canvas p-5 space-y-2.5" aria-live="polite">
            <p className="text-sm font-bold text-ink-soft">요약을 만드는 중입니다…</p>
            <div className="h-3 rounded-full bg-line-soft animate-pulse" />
            <div className="h-3 rounded-full bg-line-soft animate-pulse w-[86%]" />
            <div className="h-3 rounded-full bg-line-soft animate-pulse w-[64%]" />
          </div>
        )}

        {!isLoading && result && (
          <div className="space-y-3 text-[14px] md:text-[15px] leading-[1.75] text-ink" aria-live="polite">
            {renderInsightBlocks(result.text).map((block, index) => (
              block.type === 'list' ? (
                <ul key={`block-${index}`} className="space-y-1.5 pl-1">
                  {block.items.map((item, itemIndex) => (
                    <li key={`item-${itemIndex}`} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-2 w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={`block-${index}`}>{block.text}</p>
              )
            ))}
          </div>
        )}

        {!isLoading && !result && !error && isAiInsightConfigured && user && (
          <p className="rounded-2xl bg-canvas p-5 text-sm font-semibold text-ink-mute">
            이 종목의 사업 모델과 리스크를 정리해 드립니다. 궁금한 점이 따로 있으면 아래에 적어 주세요.
          </p>
        )}

        <div className="space-y-2 pt-1">
          <label htmlFor="stock-insight-question" className="eyebrow block">추가 질문 (선택)</label>
          <textarea
            id="stock-insight-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, QUESTION_MAX_LENGTH))}
            rows={2}
            placeholder="예: 최근 실적에서 마진이 흔들리는 이유가 뭔가요?"
            className="w-full rounded-2xl bg-canvas border border-line px-4 py-3 text-sm font-semibold text-ink placeholder:text-ink-mute focus:outline-none focus:border-brand resize-none"
          />
          <p className="text-[11px] font-semibold text-ink-mute text-right">
            {question.length}/{QUESTION_MAX_LENGTH}
          </p>
        </div>
      </div>

      <div className="p-5 md:p-7 border-t border-line space-y-3 shrink-0">
        <button
          type="button"
          onClick={runInsight}
          disabled={isDisabled}
          className="w-full h-12 rounded-2xl bg-ink text-surface font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {result ? <RefreshCw size={17} /> : <Sparkles size={17} />}
          {isLoading ? '생성 중…' : result ? '다시 요약하기' : 'AI 요약 받기'}
        </button>

        <p className="text-[11px] leading-relaxed font-semibold text-ink-mute">
          AI가 생성한 참고 정보입니다. 투자 판단의 근거로 삼기 전에 사업보고서와 공시를 직접 확인하세요.
          {result?.remaining !== null && result?.remaining !== undefined && (
            <> {' · '}오늘 {result.remaining}회 남음</>
          )}
        </p>
      </div>
    </div>
  );
};

export default StockInsightPanel;
