import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIVIDEND_REFRESH_INTERVAL_MS,
  getDividendHoldingRevision,
  getDividendRefreshState,
} from '../src/utils/dividendRefresh.js';

const asset = {
  id: 'asset-spy',
  name: 'SPY',
  ticker: 'SPY',
  buyDate: '2026-01-02',
  quantity: 2,
};
const ledger = [{
  id: 'buy-1',
  assetId: 'asset-spy',
  name: 'SPY',
  ticker: 'SPY',
  side: 'buy',
  date: '2026-01-02',
  quantity: 2,
  price: 600,
}];
const now = new Date('2026-07-28T00:00:00.000Z').getTime();

test('배당 조회 기록이 없으면 조회한다', () => {
  const result = getDividendRefreshState({ asset, ledger, registry: [], now });
  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'missing');
});

test('같은 보유 상태로 24시간 안에 확인했으면 재조회하지 않는다', () => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const result = getDividendRefreshState({
    asset,
    ledger,
    registry: [{
      assetId: asset.id,
      checkedAt: new Date(now - 60_000).toISOString(),
      holdingRevision,
    }],
    now,
  });

  assert.equal(result.shouldRefresh, false);
  assert.equal(result.reason, 'fresh');
});

test('24시간이 지나면 다시 조회한다', () => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const result = getDividendRefreshState({
    asset,
    ledger,
    registry: [{
      assetId: asset.id,
      checkedAt: new Date(now - DIVIDEND_REFRESH_INTERVAL_MS).toISOString(),
      holdingRevision,
    }],
    now,
  });

  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'stale');
});

test('매수·매도 기록이 바뀌면 24시간 전이라도 다시 계산한다', () => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const changedLedger = [...ledger, {
    id: 'sell-1',
    assetId: 'asset-spy',
    name: 'SPY',
    ticker: 'SPY',
    side: 'sell',
    date: '2026-07-28',
    quantity: 1,
    price: 700,
  }];
  const result = getDividendRefreshState({
    asset: { ...asset, quantity: 1 },
    ledger: changedLedger,
    registry: [{
      assetId: asset.id,
      checkedAt: new Date(now - 60_000).toISOString(),
      holdingRevision,
    }],
    now,
  });

  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'holding-changed');
});
