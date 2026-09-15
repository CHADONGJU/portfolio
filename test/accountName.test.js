import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatNameWithAccount,
  getAccountScope,
  normalizeAccountName,
} from '../src/utils/accountTypes.js';
import { getAssetIdentity, isRecordForAsset, mergeUniqueAssets } from '../src/utils/assetIdentity.js';
import {
  buildCanonicalTradeRows,
  getTradeAssetKey,
  reconcileAssetsWithTradeLedger,
  recoverMissingAssetsFromTradeLedger,
  resolveNextTradeRound,
} from '../src/utils/tradeReconciliation.js';
import {
  buildDividendCalculationAssets,
  getDividendHeldQuantityOnDate,
} from '../src/utils/dividendHoldings.js';
import {
  getAutomaticDividendEventKey,
  mergeAutomaticDividendRecords,
} from '../src/utils/dividendRecords.js';
import { usePortfolioMetrics } from '../src/hooks/usePortfolioMetrics.js';

// 같은 종목(삼성전자)을 키움·토스 두 일반계좌에 나눠 산 상황.
const samsung = (o) => ({ name: '삼성전자', ticker: '005930', category: '국내주식', currency: 'KRW', ...o });
const buy = (id, accountName, date, quantity, price, extra = {}) => samsung({
  id, accountName, side: 'buy', date, quantity, price, ...extra,
});
const sell = (id, accountName, date, quantity, price, extra = {}) => samsung({
  id, accountName, side: 'sell', date, quantity, price, ...extra,
});

test('계좌 이름은 앞뒤 공백과 연속 공백을 정리한다', () => {
  assert.equal(normalizeAccountName('  토스   증권 '), '토스 증권');
  assert.equal(normalizeAccountName(undefined), '');
  assert.equal(normalizeAccountName(null), '');
});

test('계좌 이름이 없으면 키가 예전과 똑같다', () => {
  // 이미 저장된 데이터의 키가 바뀌면 원장·배당 짝이 전부 풀린다.
  assert.equal(getTradeAssetKey(samsung({ round: 1 })), '005930::삼성전자#1');
  assert.equal(getAssetIdentity(samsung({ round: 1 })), '005930::삼성전자#1');
  assert.equal(getAccountScope({ accountType: 'ISA' }), 'ISA');
  assert.equal(getAccountScope({}), 'GENERAL');
  assert.equal(formatNameWithAccount('삼성전자', ''), '삼성전자');
});

test('계좌 이름이 다르면 같은 종목이라도 다른 자산이다', () => {
  const kiwoom = samsung({ id: 1, accountName: '키움', quantity: 10 });
  const toss = samsung({ id: 2, accountName: '토스', quantity: 5 });

  assert.notEqual(getAssetIdentity(kiwoom), getAssetIdentity(toss));
  assert.notEqual(getTradeAssetKey(kiwoom), getTradeAssetKey(toss));
  // 정체성이 같으면 하나만 남기는 함수라, 계좌가 다르면 둘 다 살아 있어야 한다.
  assert.equal(mergeUniqueAssets([kiwoom, toss]).length, 2);
  assert.equal(formatNameWithAccount(toss.name, toss.accountName), '삼성전자 · 토스');
});

test('자산 ID가 없는 옛 기록도 계좌 이름이 다르면 남의 자산에 붙지 않는다', () => {
  const toss = samsung({ id: 2, accountName: '토스' });

  assert.equal(isRecordForAsset(samsung({ accountName: '키움' }), toss), false);
  assert.equal(isRecordForAsset(samsung({}), toss), false);
  assert.equal(isRecordForAsset(samsung({ accountName: ' 토스 ' }), toss), true);
  // 자산 ID가 맞으면 계좌 이름과 상관없이 그 자산의 기록이다.
  assert.equal(isRecordForAsset(samsung({ assetId: 2 }), toss), true);
});

test('계좌별 수량과 평단가를 섞지 않는다', () => {
  const assets = [
    samsung({ id: 1, accountName: '키움', quantity: 0, averagePrice: 0 }),
    samsung({ id: 2, accountName: '토스', quantity: 0, averagePrice: 0 }),
  ];
  const ledger = [
    buy('b1', '키움', '2026-01-05', 10, 70000),
    buy('b2', '토스', '2026-02-05', 5, 80000),
  ];

  const [kiwoom, toss] = reconcileAssetsWithTradeLedger(assets, ledger);
  assert.equal(kiwoom.quantity, 10);
  assert.equal(kiwoom.averagePrice, 70000);
  assert.equal(toss.quantity, 5);
  assert.equal(toss.averagePrice, 80000);
});

test('한 계좌에서 판 물량의 실현손익은 그 계좌의 평단가로 계산한다', () => {
  const rows = buildCanonicalTradeRows({
    tradeLedger: [
      buy('b1', '키움', '2026-01-05', 10, 70000),
      buy('b2', '토스', '2026-02-05', 10, 90000),
      sell('s1', '토스', '2026-03-05', 10, 100000),
    ],
  });
  const tossSell = rows.find((row) => row.id === 's1');

  // 두 계좌를 합친 평단(80,000원)으로 계산하면 200,000원이 된다.
  assert.equal(tossSell.pnl, 100000);
});

test('한 계좌를 전량 매도하고 다시 사도 다른 계좌의 회차는 그대로다', () => {
  const assets = [samsung({ id: 1, accountName: '키움', quantity: 10, round: 1 })];
  const tradeLedger = [
    buy('b1', '키움', '2026-01-05', 10, 70000, { round: 1 }),
    buy('b2', '토스', '2026-02-05', 5, 80000, { round: 1 }),
    sell('s2', '토스', '2026-03-05', 5, 85000, { round: 1 }),
  ];

  assert.equal(resolveNextTradeRound({ record: samsung({ accountName: '토스' }), assets, tradeLedger }), 2);
  assert.equal(resolveNextTradeRound({ record: samsung({ accountName: '키움' }), assets, tradeLedger }), 1);
});

test('원장으로 되살린 자산도 계좌 이름을 유지한다', () => {
  const recovered = recoverMissingAssetsFromTradeLedger([], [
    buy('b1', '토스', '2026-02-05', 5, 80000, { assetId: 'toss-1' }),
  ]);

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].accountName, '토스');
});

test('같은 유형의 두 계좌도 배당 보유 수량을 계좌별로 센다', () => {
  const assets = [
    samsung({ id: 'k', accountName: '키움', accountType: 'GENERAL', quantity: 10 }),
    samsung({ id: 't', accountName: '토스', accountType: 'GENERAL', quantity: 5 }),
  ];
  const ledger = [
    buy('b1', '키움', '2026-01-05', 10, 70000, { assetId: 'k', accountType: 'GENERAL' }),
    buy('b2', '토스', '2026-02-05', 5, 80000, { assetId: 't', accountType: 'GENERAL' }),
  ];

  const calculationAssets = buildDividendCalculationAssets(assets, ledger);
  assert.equal(calculationAssets.length, 2);
  const kiwoom = calculationAssets.find((asset) => asset.accountName === '키움');
  const toss = calculationAssets.find((asset) => asset.accountName === '토스');

  assert.equal(getDividendHeldQuantityOnDate(kiwoom, ledger, '2026-03-01'), 10);
  assert.equal(getDividendHeldQuantityOnDate(toss, ledger, '2026-03-01'), 5);
  assert.equal(getDividendHeldQuantityOnDate(toss, ledger, '2026-01-20'), 0);
});

test('같은 배당을 두 계좌가 받으면 둘 다 남고, 한 계좌 무효화가 다른 계좌를 지우지 않는다', () => {
  const kiwoom = samsung({
    id: 'k-div', accountType: 'GENERAL', accountName: '키움', round: 1,
    exDate: '2026-06-27', paymentDate: '2026-08-20', amount: 3610,
  });
  const toss = samsung({
    id: 't-div', accountType: 'GENERAL', accountName: '토스', round: 1,
    exDate: '2026-06-27', paymentDate: '2026-08-20', amount: 1805,
  });

  assert.equal(mergeAutomaticDividendRecords([kiwoom], [toss]).length, 2);

  // 토스 계좌를 갱신하면서 그 배당이 무효화돼도 키움 계좌 배당은 남아야 한다.
  const invalidated = mergeAutomaticDividendRecords([], [kiwoom, toss], {
    invalidatedEventKeys: [getAutomaticDividendEventKey({ ...toss, accountType: undefined })],
  });
  assert.deepEqual(invalidated.map((row) => row.id), ['k-div']);
});

const runHook = (options) => {
  const results = [];
  const Probe = () => createElement(
    'span',
    null,
    createElement(({ value }) => {
      results.push(value);
      return null;
    }, { value: usePortfolioMetrics(options) }),
  );
  renderToStaticMarkup(createElement(Probe));
  return results[results.length - 1];
};

const baseOptions = {
  assets: [],
  trades: [],
  tradeLedger: [],
  autoDividends: [],
  receivedDividends: [],
  dividendAssetRegistry: [],
  exchangeRate: 1500,
  jpyKrwRate: 10,
  currencyRates: { KRW: 1 },
  selectedCategory: null,
  selectedDividendAsset: null,
  dividendFilter: '전체',
};

test('종목별 손익은 계좌마다 한 줄씩, 계좌 이름을 달고 나온다', () => {
  const metrics = runHook({
    ...baseOptions,
    tradeLedger: [
      buy('b1', '키움', '2026-01-05', 10, 70000),
      buy('b2', '토스', '2026-02-05', 5, 80000),
    ],
    assets: [
      samsung({ id: 1, accountName: '키움', quantity: 10, originalAveragePrice: 70000, originalCurrentPrice: 75000, buyDate: '2026-01-05' }),
      samsung({ id: 2, accountName: '토스', quantity: 5, originalAveragePrice: 80000, originalCurrentPrice: 75000, buyDate: '2026-02-05' }),
    ],
  });
  const rows = metrics.stockPerformanceSummary.filter((row) => row.name === '삼성전자');

  assert.deepEqual(rows.map((row) => row.accountName).sort(), ['키움', '토스']);
  assert.equal(rows.find((row) => row.accountName === '키움').unrealizedKRW, 50000);
  assert.equal(rows.find((row) => row.accountName === '토스').unrealizedKRW, -25000);
});

test('배당 요약은 두 계좌 수량을 합쳐 예상하고, 같은 날 두 건을 주기로 착각하지 않는다', () => {
  const dividend = (id, accountName, exDate, quantity) => samsung({
    id, accountName, exDate, quantity, amount: 361 * quantity, perShareNetAmount: 361,
    calculationSource: 'kodex',
  });
  const autoDividends = [
    dividend('k-jan', '키움', '2026-01-31', 10),
    dividend('t-jan', '토스', '2026-01-31', 5),
    dividend('k-dec', '키움', '2025-12-31', 10),
    dividend('t-dec', '토스', '2025-12-31', 5),
  ];
  const metrics = runHook({
    ...baseOptions,
    assets: [
      samsung({ id: 1, accountName: '키움', quantity: 10, originalAveragePrice: 70000, originalCurrentPrice: 70000 }),
      samsung({ id: 2, accountName: '토스', quantity: 5, originalAveragePrice: 70000, originalCurrentPrice: 70000 }),
    ],
    autoDividends,
  });
  const summary = metrics.dividendSummary.find((row) => row.name === '삼성전자');

  assert.equal(summary.expectedAmount, 361 * 15);
  // 1/31 → 12/31 한 달 간격이므로 다음 배당락은 2월이다(3월로 건너뛰면 주기를 잘못 본 것).
  assert.ok(!String(summary.status).includes('3월'), summary.status);
});
