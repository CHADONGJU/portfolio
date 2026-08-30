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

test('해외 보유 평단은 달러 기준, 원화 평단은 매수일 환율 원금 기준이다', () => {
  const assets = [{
    id: 'soxl',
    name: 'SOXL',
    ticker: 'SOXL',
    category: '해외주식',
    currency: 'USD',
    quantity: 2,
    averagePrice: 150,
    originalAveragePrice: 150,
    currentPrice: 192000,
    originalCurrentPrice: 160,
    buyDate: '2026-01-05',
  }];
  const tradeLedger = [
    {
      id: 'b1', name: 'SOXL', ticker: 'SOXL', category: '해외주식', currency: 'USD',
      side: 'buy', date: '2026-01-05', quantity: 1, price: 100, fxRate: 1300,
    },
    {
      id: 'b2', name: 'SOXL', ticker: 'SOXL', category: '해외주식', currency: 'USD',
      side: 'buy', date: '2026-02-05', quantity: 1, price: 200, fxRate: 1400,
    },
  ];

  const metrics = runHook({
    ...baseOptions,
    assets,
    tradeLedger,
    exchangeRate: 1200,
    currencyRates: { KRW: 1, USD: 1200 },
  });
  const soxl = metrics.enhancedAssets.find((row) => row.ticker === 'SOXL');

  assert.ok(soxl);
  assert.equal(soxl.nativeAveragePrice, 150);
  assert.equal(soxl.purchaseNative, 300);
  assert.equal(soxl.purchaseKRW, 100 * 1300 + 200 * 1400);
  assert.equal(soxl.purchaseKRWSource, 'trade-date-rate');
  assert.equal(soxl.krwAveragePrice, (100 * 1300 + 200 * 1400) / 2);
  assert.equal(soxl.currentNative, 320);
  assert.equal(soxl.currentKRW, 320 * 1200);
  assert.equal(soxl.profitKRW, 320 * 1200 - (100 * 1300 + 200 * 1400));
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

  const metrics = runHook({
    ...baseOptions,
    assets: [{
      id: 'kodex', name: 'KODEX', ticker: '453810', category: '국내주식',
      currency: 'KRW', quantity: 100, originalAveragePrice: 10000, originalCurrentPrice: 10000,
    }],
    autoDividends,
  });
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

test('매도 후 실제 수령 배당이 없는 종목은 배당 목록에서 제외한다', () => {
  const metrics = runHook({
    ...baseOptions,
    autoDividends: [{
      id: 'gev-feed', name: 'GEV', ticker: 'GEV', currency: 'USD',
      exDate: '2026-06-16', paymentDate: '2026-07-14', quantity: 1, amount: 0.425,
    }],
    dividendAssetRegistry: [{ name: 'GEV', ticker: 'GEV', currency: 'USD', hasDividends: true }],
  });

  assert.equal(metrics.dividendSummary.some((row) => row.name === 'GEV'), false);
});

test('매도 종목의 실제 수령 배당은 과거 내역으로만 남고 미래 금액을 예측하지 않는다', () => {
  const received = {
    id: 'unh-paid', name: 'UNH', ticker: 'UNH', currency: 'USD',
    exDate: '2026-06-15', paymentDate: '2026-06-23', quantity: 16, amount: 31.552,
    entitlementVerified: true,
  };
  const metrics = runHook({
    ...baseOptions,
    autoDividends: [received],
    receivedDividends: [received],
    dividendAssetRegistry: [{ name: 'UNH', ticker: 'UNH', currency: 'USD', hasDividends: true }],
  });
  const unh = metrics.dividendSummary.find((row) => row.name === 'UNH');

  assert.ok(unh);
  assert.equal(unh.isCurrentHolding, false);
  assert.equal(unh.totalAmount, 31.552);
  assert.equal(unh.expectedAmount, 0);
  assert.equal(unh.expectedAnnualAmount, 0);
  assert.equal(unh.annualDividendYieldPercent, null);
  assert.equal(unh.status, '과거 보유 · 수령 내역');
});

test('현재 보유 중인 배당 종목은 현재 목록으로 표시한다', () => {
  const dividend = {
    id: 'ups-paid', name: 'UPS', ticker: 'UPS', currency: 'USD',
    exDate: '2026-05-18', paymentDate: '2026-06-04', quantity: 10,
    perShareNetAmount: 1.394, amount: 13.94,
  };
  const metrics = runHook({
    ...baseOptions,
    assets: [{
      id: 'ups', name: 'UPS', ticker: 'UPS', category: '해외주식', currency: 'USD',
      quantity: 10, originalAveragePrice: 97.41, originalCurrentPrice: 102.13,
    }],
    autoDividends: [dividend],
    receivedDividends: [dividend],
  });
  const ups = metrics.dividendSummary.find((row) => row.name === 'UPS');

  assert.ok(ups);
  assert.equal(ups.isCurrentHolding, true);
  assert.ok(ups.expectedAmount > 0);
});

test('전량 매도해 0주가 된 종목이 목록에 남아도 매입원가를 평가손실로 잡지 않는다', () => {
  // 실제로 보고된 문제: 25주를 전량 매도한 삼성전자가 보유 목록에 0주로 남아 있으면
  // 평가액 0 − 확정 원금이 통째로 평가손실이 됐다. 그 손실은 이미 실현손익으로
  // 따로 세고 있어서, 연 수익률에서 165만 원 이익이 19만 원으로 짓눌렸다.
  const metrics = runHook({
    ...baseOptions,
    assets: [
      {
        id: 'closed', name: '삼성전자', ticker: '005930', category: '국내주식', currency: 'KRW',
        quantity: 0, averagePrice: 58_000, originalAveragePrice: 58_000,
        currentPrice: 70_000, originalCurrentPrice: 70_000,
        manualPurchaseKRW: 1_450_000,
      },
      {
        id: 'open', name: 'SK하이닉스', ticker: '000660', category: '국내주식', currency: 'KRW',
        quantity: 2, averagePrice: 100_000, originalAveragePrice: 100_000,
        currentPrice: 110_000, originalCurrentPrice: 110_000,
      },
    ],
  });

  const closed = metrics.enhancedAssets.find((asset) => asset.id === 'closed');
  assert.equal(closed.purchaseKRW, 0);
  assert.equal(closed.currentKRW, 0);
  assert.equal(closed.profitKRW, 0);

  // 남아 있는 종목의 평가손익만 잡힌다(2주 × 1만 원).
  const investedProfit = metrics.enhancedAssets.reduce((sum, asset) => sum + asset.profitKRW, 0);
  assert.equal(investedProfit, 20_000);
});
