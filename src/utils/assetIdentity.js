// 매매·배당 기록이 어떤 보유 자산의 것인지 판정한다.
// 티커가 양쪽에 있으면 티커로, 없으면 이름으로 맞춘다. 회차(round)까지 봐야
// 전량 매도 후 재매수한 물량의 기록이 이전 회차에 섞이지 않는다.
import { getTradeRound } from './tradeReconciliation.js';
import { parseNumber } from './formatters.js';
import { getAccountNameKeySuffix, normalizeAccountName } from './accountTypes.js';

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

  // 같은 종목을 다른 계좌에 따로 담았으면 티커가 같아도 남의 기록이다.
  if (normalizeAccountName(record.accountName) !== normalizeAccountName(asset.accountName)) return false;

  const assetTicker = normalizeTicker(asset.ticker);
  const recordTicker = normalizeTicker(record.ticker);
  if (assetTicker && recordTicker) return assetTicker === recordTicker;

  return Boolean(asset.name && record.name && asset.name === record.name);
};

/** 자산 한 건의 정체성. 같은 종목이라도 계좌 이름이나 회차가 다르면 다른 자산이다. */
export const getAssetIdentity = (asset) => (
  `${asset.ticker || ''}::${asset.name || ''}${getAccountNameKeySuffix(asset)}#${getTradeRound(asset)}`
);

const getAssetUpdatedAtTime = (asset = {}) => {
  const timestamp = new Date(asset.updatedAt || asset.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareAssetVersions = (left = {}, right = {}) => {
  const leftTime = getAssetUpdatedAtTime(left);
  const rightTime = getAssetUpdatedAtTime(right);
  if (leftTime !== rightTime) return leftTime - rightTime;

  return parseNumber(left.quantity) - parseNumber(right.quantity);
};

export const mergeUniqueAssets = (primary = [], secondary = []) => {
  const assetByKey = new Map();

  [...primary, ...secondary].forEach((asset) => {
    const key = getAssetIdentity(asset);
    const existing = assetByKey.get(key);
    if (!existing || compareAssetVersions(existing, asset) <= 0) {
      assetByKey.set(key, asset);
    }
  });

  return [...assetByKey.values()];
};
