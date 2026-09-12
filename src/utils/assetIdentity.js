// 매매·배당 기록이 어떤 보유 자산의 것인지 판정한다.
// 티커가 양쪽에 있으면 티커로, 없으면 이름으로 맞춘다. 회차(round)까지 봐야
// 전량 매도 후 재매수한 물량의 기록이 이전 회차에 섞이지 않는다.
const normalizeTicker = (ticker = '') => String(ticker || '').trim().toUpperCase();

/**
 * 자산 ID가 양쪽에 있으면 ID를 최우선으로 사용한다.
 * 복구 과정에서 같은 티커의 서로 다른 포지션이 함께 남아 있어도
 * 티커만 같다는 이유로 수량을 합치지 않게 한다.
 */
export const isRecordForAsset = (record = {}, asset = {}) => {
  const assetId = asset.id === undefined || asset.id === null ? '' : String(asset.id);
  const recordAssetId = record.assetId === undefined || record.assetId === null
    ? ''
    : String(record.assetId);

  if (assetId && recordAssetId) return assetId === recordAssetId;
  if (assetId && record.sourceId === `asset-${assetId}`) return true;

  const assetTicker = normalizeTicker(asset.ticker);
  const recordTicker = normalizeTicker(record.ticker);
  if (assetTicker && recordTicker) return assetTicker === recordTicker;

  return Boolean(asset.name && record.name && asset.name === record.name);
};
