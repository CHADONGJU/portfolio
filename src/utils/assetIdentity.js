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
