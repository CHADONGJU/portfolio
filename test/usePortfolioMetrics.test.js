import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { usePortfolioMetrics, toNativePrice } from '../src/hooks/usePortfolioMetrics.js';

/**
 * usePortfolioMetrics는 화면에 뜨는 거의 모든 숫자를 파생시키는데 테스트가 없었다.
 * 순수 계산 훅이라 서버 렌더 한 번으로 결과를 꺼낼 수 있다.
 */
const runHook = (options) => {
  const results = [];
  const Probe = () => createElement(
    'span',
    null,
    // 훅 결과를 렌더 밖 변수에 대입하면 순수성 규칙에 걸린다.
    // 자식 요소의 prop으로 흘려보내 렌더 중에 수집한다.
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

test('빈 포트폴리오에서도 터지지 않고 0을 돌려준다', () => {
  const metrics = runHook(baseOptions);

  assert.equal(metrics.totalConvertedKRW, 0);
  assert.equal(metrics.totalConvertedNetProfit, 0);
  assert.deepEqual(metrics.enhancedAssets, []);
  assert.deepEqual(metrics.stockPerformanceSummary, []);
  assert.deepEqual(metrics.filteredHistory, []);
});

test('종목별 실현손익이 헤더 합계와 같은 환율을 쓴다', () => {
  // 매수 1300, 매도 1450, 오늘 1500. 손익은 매수 시점 환율로 고정돼야 하고,
  // 종목 카드와 헤더 합계가 같은 값을 보여야 한다.
  const tradeLedger = [
    {
      id: 'b1', name: 'SOXL', ticker: 'SOXL', currency: 'USD',
      side: 'buy', date: '2026-01-05', quantity: 10, price: 100, fxRate: 1300,
    },
    {
      id: 's1', name: 'SOXL', ticker: 'SOXL', currency: 'USD',
      side: 'sell', date: '2026-03-05', quantity: 10, price: 120, fxRate: 1450,
    },
  ];

  const metrics = runHook({ ...baseOptions, tradeLedger });
  const soxl = metrics.stockPerformanceSummary.find((row) => row.name === 'SOXL');

  assert.ok(soxl, 'SOXL 요약이 있어야 한다');
  assert.equal(soxl.realizedNative, 200);
  assert.equal(soxl.unrealizedNative, 0);
  assert.equal(soxl.dividendNative, 0);
  assert.equal(soxl.totalNative, 200);
  assert.equal(soxl.realizedKRW, metrics.totalConvertedNetProfit);
  // 오늘 환율(1500)로 근사하면 300,000이 나온다. 그게 아니어야 한다.
  assert.notEqual(soxl.realizedKRW, 200 * 1500);
  assert.equal(Math.round(soxl.realizedKRW), 260000);
});

test('배당 금액이 비어 있어도 합계가 NaN이 되지 않는다', () => {
  const receivedDividends = [
    {
      id: 'd1', name: 'JEPI', ticker: 'JEPI', currency: 'USD',
      exDate: '2026-05-01', amount: undefined, quantity: 10,
    },
    {
      id: 'd2', name: 'JEPI', ticker: 'JEPI', currency: 'USD',
      exDate: '2026-06-01', amount: 5, quantity: 10, fxRate: 1400,
    },
  ];

  const metrics = runHook({ ...baseOptions, receivedDividends });
  const jepi = metrics.stockPerformanceSummary.find((row) => row.name === 'JEPI');

  assert.ok(jepi);
  assert.ok(Number.isFinite(jepi.dividendKRW), `dividendKRW=${jepi.dividendKRW}`);
  assert.ok(Number.isFinite(jepi.totalKRW), `totalKRW=${jepi.totalKRW}`);
  assert.equal(Math.round(jepi.dividendKRW), 7000);
});

test('지급일만 있는 배당 기록이 상세 표에서 서로를 지우지 않는다', () => {
  // 배당락일 없이 지급일만 있는 세 건. 예전에는 중복 제거 키가 모두
  // "JEPI::undefined::USD"로 같아져 두 건이 상세 표에서만 사라졌다.
  const records = ['2026-05-01', '2026-06-01', '2026-07-01'].map((paymentDate, index) => ({
    id: `d${index}`,
    name: 'JEPI',
    ticker: 'JEPI',
    currency: 'USD',
    paymentDate,
    amount: 5,
    quantity: 10,
  }));

  const metrics = runHook({
    ...baseOptions,
    autoDividends: records,
    receivedDividends: records,
    selectedDividendAsset: 'JEPI',
  });

  assert.equal(metrics.filteredHistory.length, 3);
});

test('배당락일이 없는 기록이 "NaN월"을 만들지 않는다', () => {
  const receivedDividends = [{
    id: 'd1', name: 'JEPI', ticker: 'JEPI', currency: 'USD',
    paymentDate: '2026-05-01', amount: 5, quantity: 10,
  }];

  const metrics = runHook({ ...baseOptions, receivedDividends });
  const statuses = metrics.dividendSummary.map((row) => String(row.status || ''));

  statuses.forEach((status) => {
    assert.ok(!status.includes('NaN'), `상태 문구에 NaN이 들어갔다: ${status}`);
  });
});

test('월말 기준일 월배당 예측이 한 달을 건너뛰지 않는다', () => {
  const autoDividends = [{
    id: 'a1', name: 'KODEX', ticker: '453810', currency: 'KRW',
    exDate: '2026-01-31', amount: 100, quantity: 100,
    calculationSource: 'kodex',
  }, {
    id: 'a2', name: 'KODEX', ticker: '453810', currency: 'KRW',
    exDate: '2025-12-31', amount: 100, quantity: 100,
    calculationSource: 'kodex',
  }];

  const metrics = runHook({ ...baseOptions, autoDividends });
  const kodex = metrics.dividendSummary.find((row) => row.name === 'KODEX');

  assert.ok(kodex);
  const status = String(kodex.status || '');
  assert.ok(!status.includes('NaN'), status);
  // 1/31 다음 월배당은 3월이 아니라 2월이어야 한다.
  assert.ok(!status.includes('3월'), `2월을 건너뛰었다: ${status}`);
});

test('toNativePrice는 원화 환산값에서 현지 가격을 역산한다', () => {
  assert.equal(toNativePrice(120, 0, 1500), 120);
  assert.equal(toNativePrice(0, 180000, 1500), 120);
  assert.equal(toNativePrice(0, 0, 1500), 0);
  assert.equal(toNativePrice(0, 180000, 0), 0);
});
