import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPortfolioSnapshot } from '../src/utils/portfolioRecovery.js';

test('축약된 클라우드 원장보다 로컬 원장이 풍부하면 매수 로트를 복구한다', () => {
  const current = {
    assets: [{ id: 1, name: 'ETF', ticker: 'ETF', quantity: 30 }],
    tradeLedger: [{ id: 'collapsed', assetId: 1, name: 'ETF', ticker: 'ETF', side: 'buy', quantity: 30 }],
  };
  const recovered = {
    assets: [
      { id: 1, name: 'ETF', ticker: 'ETF', quantity: 30 },
      { id: 2, name: '삼성전자', ticker: '005930', quantity: 5 },
    ],
    tradeLedger: [
      { id: 'lot-1', assetId: 1, name: 'ETF', ticker: 'ETF', side: 'buy', quantity: 10 },
      { id: 'lot-2', assetId: 1, name: 'ETF', ticker: 'ETF', side: 'buy', quantity: 20 },
      { id: 'samsung', assetId: 2, name: '삼성전자', ticker: '005930', side: 'buy', quantity: 5 },
    ],
  };

  const result = recoverPortfolioSnapshot(current, recovered);

  assert.equal(result.recovered, true);
  assert.equal(result.recoveredAssetCount, 1);
  assert.equal(result.snapshot.assets.length, 2);
  assert.deepEqual(
    result.snapshot.tradeLedger.filter((row) => row.ticker === 'ETF').map((row) => row.id),
    ['lot-1', 'lot-2'],
  );
  assert.equal(result.snapshot.tradeLedger.some((row) => row.id === 'collapsed'), false);
});

test('현재 클라우드가 같거나 더 풍부하면 과거 백업을 되살리지 않는다', () => {
  const current = {
    assets: [{ id: 1, name: 'ETF', ticker: 'ETF' }],
    tradeLedger: [{ id: 'current', name: 'ETF', ticker: 'ETF' }],
  };
  const recovered = {
    assets: [{ id: 1, name: 'ETF', ticker: 'ETF' }],
    tradeLedger: [{ id: 'old', name: 'ETF', ticker: 'ETF' }],
  };

  const result = recoverPortfolioSnapshot(current, recovered);
  assert.equal(result.recovered, false);
  assert.equal(result.snapshot, current);
});

test('빈 클라우드에는 로컬 자산과 포트폴리오 설정을 복구한다', () => {
  const current = {
    portfolioName: '기본 포트폴리오',
    assets: [],
    trades: [],
    memos: [],
    tradeLedger: [],
    autoDividends: [],
    confirmedDividends: [],
    dividendAssetRegistry: [],
    targetPortfolio: { enabled: false },
  };
  const recovered = {
    portfolioName: '찬호 포트폴리오',
    assets: [{ id: 1, name: 'Nifty50', ticker: '453810' }],
    tradeLedger: [{ id: 'buy-1', name: 'Nifty50', ticker: '453810', side: 'buy', quantity: 48 }],
    targetPortfolio: { enabled: true, targetAmount: 100000000 },
  };

  const result = recoverPortfolioSnapshot(current, recovered);

  assert.equal(result.recovered, true);
  assert.equal(result.snapshot.portfolioName, '찬호 포트폴리오');
  assert.deepEqual(result.snapshot.targetPortfolio, recovered.targetPortfolio);
  assert.equal(result.snapshot.assets.length, 1);
  assert.equal(result.snapshot.tradeLedger.length, 1);
});

test('자산 개수가 같아도 로컬 원장의 수정 시각이 더 최근이면 로컬 수량을 복구한다', () => {
  const current = {
    assets: [{ id: 1, name: 'Nifty50', ticker: '453810', quantity: 40 }],
    tradeLedger: [{ id: 'buy-1', ticker: '453810', quantity: 40, updatedAt: '2026-05-26T08:00:00.000Z' }],
  };
  const recovered = {
    assets: [{ id: 1, name: 'Nifty50', ticker: '453810', quantity: 48 }],
    tradeLedger: [{ id: 'buy-1', ticker: '453810', quantity: 48, updatedAt: '2026-06-01T08:00:00.000Z' }],
  };

  const result = recoverPortfolioSnapshot(current, recovered);

  assert.equal(result.recovered, true);
  assert.equal(result.snapshot.assets[0].quantity, 48);
  assert.equal(result.snapshot.tradeLedger[0].quantity, 48);
});
