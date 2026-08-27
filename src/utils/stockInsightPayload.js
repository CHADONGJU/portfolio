/**
 * 종목 행 하나를 AI 프록시로 보낼 최소 payload로 줄인다.
 *
 * enhancedAssets에는 화면 계산용 파생 필드가 수십 개 붙어 있다. 그걸 통째로
 * 보내면 남의 서버 로그에 내 포트폴리오 전체가 남고, 토큰도 그만큼 더 든다.
 * 모델이 회사를 특정하는 데 필요한 것과 맥락 한 줄만 남긴다.
 *
 * 금액(총 매입금액, 평가금액, 손익 절대액)은 일부러 빼 둔다. 회사 설명을
 * 받는 데 쓸모가 없고, 외부로 나가서 좋을 것도 없다.
 */
const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildStockInsightPayload = (asset) => {
  if (!asset || typeof asset !== 'object') return null;

  const name = String(asset.name || '').trim();
  if (!name) return null;

  const currency = String(asset.originalCurrency || asset.currency || 'KRW').toUpperCase();

  return {
    name,
    ticker: String(asset.ticker || '').trim(),
    category: String(asset.category || '').trim(),
    currency,
    quantity: toFiniteNumber(asset.quantity),
    averagePrice: toFiniteNumber(
      asset.nativeAveragePrice ?? asset.originalAveragePrice ?? asset.averagePrice,
    ),
    currentPrice: toFiniteNumber(asset.nativeCurrentPrice ?? asset.currentPrice),
    returnPercent: toFiniteNumber(asset.returnPercent),
    buyDate: String(asset.displayBuyDate || asset.buyDate || '').trim(),
  };
};

/** 현금은 설명할 회사가 없다. 버튼 자체를 숨기는 판단에 쓴다. */
export const canSummarizeAsset = (asset) => Boolean(
  asset
  && asset.category !== '현금'
  && String(asset.name || '').trim(),
);
