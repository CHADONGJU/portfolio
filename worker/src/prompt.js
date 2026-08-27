/**
 * 프롬프트는 서버에서 만든다.
 *
 * 클라이언트가 messages 배열을 통째로 보내게 하면, 남의 브라우저에서 내 키로
 * 아무 프롬프트나 돌릴 수 있는 무료 LLM 게이트웨이가 되어 버린다. 프런트는
 * 종목 필드만 넘기고, 문장 조립과 길이 제한은 여기서 한다.
 */
const SYSTEM_PROMPT = [
  '당신은 한국 개인 투자자를 돕는 기업 분석 어시스턴트입니다.',
  '사용자가 보유한 종목에 대해 사업 모델, 수익 구조, 주요 리스크를 한국어로 간결하게 설명합니다.',
  '규칙:',
  '- 반드시 한국어로만 답합니다. 영어 문장으로 답하지 않습니다.',
  '- 생각 과정, 분석 계획, 규칙 재확인을 출력하지 않습니다. 최종 답변만 씁니다.',
  '- 매수/매도 추천, 목표주가, 수익 예측은 하지 않습니다.',
  '- 확인되지 않은 최신 실적이나 뉴스는 지어내지 말고, 모르면 모른다고 밝힙니다.',
  '- 사용자가 넘긴 보유 수량과 수익률은 맥락 참고용이며, 그 숫자를 다시 계산하거나 평가하지 않습니다.',
  '- 마크다운 헤딩(#)은 쓰지 말고, 짧은 문단과 "- " 목록으로만 씁니다.',
].join('\n');

export const MAX_QUESTION_LENGTH = 300;

const clampText = (value, max) => String(value ?? '').trim().slice(0, max);

const formatNumber = (value) => (
  Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : null
);

/** 프런트가 보낸 필드에서 신뢰할 수 있는 것만 골라 정규화한다. */
export const normalizeAssetContext = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const name = clampText(raw.name, 80);
  if (!name) return null;

  return {
    name,
    ticker: clampText(raw.ticker, 30),
    category: clampText(raw.category, 20),
    currency: clampText(raw.currency, 10).toUpperCase(),
    quantity: Number(raw.quantity),
    averagePrice: Number(raw.averagePrice),
    currentPrice: Number(raw.currentPrice),
    returnPercent: Number(raw.returnPercent),
    buyDate: clampText(raw.buyDate, 20),
  };
};

export const buildInsightMessages = (asset, question) => {
  const lines = [`종목명: ${asset.name}`];
  if (asset.ticker) lines.push(`티커/코드: ${asset.ticker}`);
  if (asset.category) lines.push(`자산군: ${asset.category}`);
  if (Number.isFinite(asset.quantity) && asset.quantity > 0) {
    lines.push(`보유 수량: ${formatNumber(asset.quantity)}`);
  }
  if (Number.isFinite(asset.averagePrice) && asset.averagePrice > 0) {
    lines.push(`평균 매입가: ${formatNumber(asset.averagePrice)} ${asset.currency || ''}`.trim());
  }
  if (Number.isFinite(asset.currentPrice) && asset.currentPrice > 0) {
    lines.push(`현재가: ${formatNumber(asset.currentPrice)} ${asset.currency || ''}`.trim());
  }
  if (Number.isFinite(asset.returnPercent)) {
    lines.push(`평가 수익률: ${asset.returnPercent.toFixed(2)}%`);
  }
  if (asset.buyDate) lines.push(`최초 매수일: ${asset.buyDate}`);

  const trimmedQuestion = clampText(question, MAX_QUESTION_LENGTH);
  const task = trimmedQuestion
    ? `아래 질문에 답해 주세요.\n질문: ${trimmedQuestion}`
    : [
      '아래 순서로 정리해 주세요.',
      '1) 이 회사가 무엇으로 돈을 버는지 3~4문장',
      '2) 실적을 좌우하는 핵심 변수 2~3개',
      '3) 투자자가 주의해야 할 리스크 2~3개',
      '4) 이 종목을 볼 때 함께 확인하면 좋은 지표',
    ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${lines.join('\n')}\n\n${task}` },
  ];
};

/**
 * 영어 사고 과정 서두를 걷어낸다.
 *
 * 프롬프트로 "생각 과정을 쓰지 마라"라고 해도 능력이 부족한 모델은 그대로 무시하고
 * "Here's a thinking process:" 같은 서두를 본문에 붙여 보낸다. 사용자에게 그게
 * 그대로 보이면 기능이 고장 난 것처럼 읽히므로, 마지막 방어선으로 여기서 자른다.
 *
 * 모델을 제대로 고르면 필요 없는 코드다. 다만 폴백으로 어떤 모델이 걸릴지
 * 보장할 수 없어서 남겨 둔다.
 */
const PREAMBLE_START = /^(here'?s|here is|okay|ok[,.]|let me|i need to|i'?ll|first[,.]|thinking|analysis|step 1|draft)/i;

const hangulRatio = (line) => {
  const stripped = line.replace(/\s/g, '');
  if (!stripped) return 0;
  return (stripped.match(/[가-힣]/g) || []).length / stripped.length;
};

export const stripReasoningPreamble = (text) => {
  const lines = String(text ?? '').split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim());
  if (firstContentIndex === -1) return String(text ?? '').trim();

  // 첫 줄이 한국어면 정상 응답이다. 건드리지 않는다.
  if (hangulRatio(lines[firstContentIndex]) > 0.3) return String(text).trim();
  if (!PREAMBLE_START.test(lines[firstContentIndex].trim())) return String(text).trim();

  const koreanStart = lines.findIndex((line) => hangulRatio(line) > 0.3);
  // 한국어가 아예 없으면 자를 기준이 없다. 원문을 그대로 두고 호출부가 판단하게 한다.
  if (koreanStart === -1) return String(text).trim();

  return lines.slice(koreanStart).join('\n').trim();
};
