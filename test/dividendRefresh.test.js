import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIVIDEND_REFRESH_INTERVAL_MS,
  DIVIDEND_REFRESH_VERSION,
  getDividendHoldingRevision,
  getDividendRefreshState,
  getDividendRefreshVersion,
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

test('scopes source migrations without refreshing unrelated USD assets', () => {
  assert.equal(getDividendRefreshVersion({ ticker: 'JEPI' }), 9);
  assert.equal(getDividendRefreshVersion({ ticker: 'SPY' }), DIVIDEND_REFRESH_VERSION);
  assert.equal(getDividendRefreshVersion({ ticker: 'QCOM' }), 9);
  assert.equal(getDividendRefreshVersion({ ticker: '277630' }), 11);
  assert.equal(getDividendRefreshVersion({ ticker: '453810.KS' }), 11);
  assert.equal(getDividendRefreshVersion({ ticker: '477730' }), 11);
  assert.equal(getDividendRefreshVersion({ ticker: 'V' }), 9);
});

test('계좌 유형이 바뀌면 같은 보유수량도 배당을 다시 계산한다', () => {
  const generalAsset = { ...asset, accountType: 'GENERAL' };
  const isaAsset = { ...asset, accountType: 'ISA' };

  assert.notEqual(
    getDividendHoldingRevision(generalAsset, ledger),
    getDividendHoldingRevision(isaAsset, ledger),
  );
});

test('배당 조회 기록이 없으면 조회한다', () => {
  const result = getDividendRefreshState({ asset, ledger, registry: [], now });
  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'missing');
});

test('직전 배당 조회가 실패했으면 즉시 다시 조회한다', () => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const result = getDividendRefreshState({
    asset,
    ledger,
    registry: [{
      assetId: asset.id,
      refreshVersion: DIVIDEND_REFRESH_VERSION,
      checkedAt: new Date(now - 60_000).toISOString(),
      holdingRevision,
      syncStatus: 'error',
    }],
    now,
  });

  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'previous-error');
});

test('같은 보유 상태로 24시간 안에 확인했으면 재조회하지 않는다', () => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const result = getDividendRefreshState({
    asset,
    ledger,
    registry: [{
      assetId: asset.id,
      refreshVersion: DIVIDEND_REFRESH_VERSION,
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
      refreshVersion: DIVIDEND_REFRESH_VERSION,
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
      refreshVersion: DIVIDEND_REFRESH_VERSION,
      checkedAt: new Date(now - 60_000).toISOString(),
      holdingRevision,
    }],
    now,
  });

  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'holding-changed');
});

test('지급일 스키마 이전 조회 기록은 즉시 다시 조회한다', () => {
  const holdingRevision = getDividendHoldingRevision(asset, ledger);
  const result = getDividendRefreshState({
    asset,
    ledger,
    registry: [{
      assetId: asset.id,
      refreshVersion: 1,
      checkedAt: new Date(now - 60_000).toISOString(),
      holdingRevision,
    }],
    now,
  });

  assert.equal(result.shouldRefresh, true);
  assert.equal(result.reason, 'schema-changed');
});

test('복구로 자산 ID가 바뀌어도 같은 티커의 실제 원장은 배당 보유 상태에 포함한다', () => {
  const revision = getDividendHoldingRevision(asset, [
    ...ledger,
    {
      id: 'recovered-position',
      assetId: 'different-spy-position',
      name: 'SPY',
      ticker: 'SPY',
      side: 'buy',
      date: '2026-01-03',
      quantity: 100,
      price: 601,
    },
  ]);

  assert.equal(revision.includes('recovered-position'), true);
  assert.equal(revision.includes('buy-1'), true);
});
