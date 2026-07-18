import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutoDividendRows,
  buildDividendAssetUniverse,
  getAssetDividendProfile,
  getHeldQuantityOnExDate,
  isVerifiableDividendRecord,
  recalculateEstimatedDividendRow,
  selectReportedDividendRecords,
} from '../src/utils/dividendCalculations.js';

const toTimestamp = (date) => Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);

test('미국 배당은 기본 15% 원천세를 적용한다', () => {
  const profile = getAssetDividendProfile({
    ticker: 'JEPI',
    category: '해외주식',
    currency: 'USD',
  });

  assert.equal(profile.sourceCountry, 'US');
  assert.equal(profile.dividendTaxRate, 0.15);
  assert.equal(profile.adrFeePerShare, 0);
});

test('국내 배당은 기본 15.4% 원천세를 적용한다', () => {
  const profile = getAssetDividendProfile({
    ticker: '005930',
    category: '국내주식',
    currency: 'KRW',
  });

  assert.equal(profile.sourceCountry, 'KR');
  assert.equal(profile.dividendTaxRate, 0.154);
  assert.equal(profile.adrFeePerShare, 0);
});

test('비과세 계좌는 명시한 0% 배당세율을 유지한다', () => {
  const profile = getAssetDividendProfile({
    ticker: '005930',
    category: '국내주식',
    currency: 'KRW',
    accountType: 'ISA',
    dividendTaxRate: 0,
  });

  assert.equal(profile.accountType, 'ISA');
  assert.equal(profile.dividendTaxRate, 0);
});

test('NVO는 덴마크 원천세를 적용하고 ADR 수수료는 자동 차감하지 않는다', () => {
  const profile = getAssetDividendProfile({
    ticker: 'NVO',
    category: '해외주식',
    currency: 'USD',
  });

  assert.equal(profile.sourceCountry, 'DK');
  assert.equal(profile.dividendTaxRate, 0.27);
  assert.equal(profile.adrFeePerShare, 0);
});

test('NVO legacy automatic ADR fee is ignored unless the fee was explicitly entered', () => {
  const legacyProfile = getAssetDividendProfile({
    ticker: 'NVO',
    category: '해외주식',
    currency: 'USD',
    adrFeePerShare: 0.015,
  });
  const explicitProfile = getAssetDividendProfile({
    ticker: 'NVO',
    category: '해외주식',
    currency: 'USD',
    adrFeePerShare: 0.015,
    adrFeePerShareExplicit: true,
  });

  assert.equal(legacyProfile.adrFeePerShare, 0);
  assert.equal(explicitProfile.adrFeePerShare, 0.015);
});

test('배당락일 당일 매수는 제외하고 당일 매도는 기존 수량을 유지한다', () => {
  const asset = {
    id: 1,
    name: '테스트',
    ticker: 'TEST',
    quantity: 8,
    buyDate: '2025-01-01',
  };
  const ledger = [
    { assetId: 1, name: '테스트', side: 'buy', quantity: 10, date: '2025-01-01' },
    { assetId: 1, name: '테스트', side: 'sell', quantity: 4, date: '2025-03-01' },
    { assetId: 1, name: '테스트', side: 'buy', quantity: 2, date: '2025-04-01' },
    { assetId: 1, name: '테스트', side: 'sell', quantity: 3, date: '2025-04-01' },
  ];

  assert.equal(getHeldQuantityOnExDate(asset, ledger, '2025-04-01'), 6);
});

test('NVO 자동 배당은 27% 원천세만 반영하고 미확인 ADR 수수료를 차감하지 않는다', () => {
  const asset = {
    id: 1,
    name: 'Novo Nordisk',
    ticker: 'NVO',
    category: '해외주식',
    currency: 'USD',
    originalCurrency: 'USD',
    quantity: 80,
    buyDate: '2025-01-01',
  };
  const ledger = [
    {
      assetId: 1,
      name: 'Novo Nordisk',
      ticker: 'NVO',
      side: 'buy',
      quantity: 80,
      price: 70,
      date: '2025-01-01',
    },
  ];
  const rows = buildAutoDividendRows({
    asset,
    ledger,
    dividendStartDate: '2025-01-01',
    dividends: {
      one: {
        date: toTimestamp('2026-03-30'),
        amount: 1.275101,
        recordDate: '2026-03-31',
        paymentDate: '2026-04-07',
      },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 80);
  assert.ok(Math.abs(rows[0].amount - 74.4658984) < 0.000001);
  assert.ok(Math.abs(rows[0].perShareNetAmount - 0.93082373) < 0.000001);
  assert.equal(rows[0].feeAmount, 0);
  assert.equal(rows[0].recordDate, '2026-03-31');
  assert.equal(rows[0].paymentDate, '2026-04-07');
});

test('photo receipt benchmark keeps NVO income within source-data rounding tolerance', () => {
  const asset = {
    id: 90,
    name: 'Novo Nordisk',
    ticker: 'NVO',
    category: '해외주식',
    currency: 'USD',
    originalCurrency: 'USD',
    quantity: 112,
    buyDate: '2025-01-01',
  };
  const ledger = [
    { assetId: 90, ticker: 'NVO', side: 'buy', quantity: 64, date: '2025-01-01' },
    { assetId: 90, ticker: 'NVO', side: 'buy', quantity: 48, date: '2026-01-01' },
  ];
  const rows = buildAutoDividendRows({
    asset,
    ledger,
    dividendStartDate: '2025-01-01',
    dividends: {
      first: { date: toTimestamp('2025-08-18'), amount: 0.41155 },
      second: { date: toTimestamp('2026-03-30'), amount: 0.87369 },
    },
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].quantity, 64);
  assert.equal(rows[1].quantity, 112);
  assert.equal(rows[0].feeAmount, 0);
  assert.equal(rows[1].feeAmount, 0);
  assert.ok(Math.abs(rows[0].amount - 19.20) < 0.05);
  assert.ok(Math.abs(rows[1].amount - 71.40) < 0.05);
});

test('2025+ overseas photo ledger total matches the public per-share calculation', () => {
  const receiptFixtures = [
    ['JEPI', 0.54, 135],
    ['JEPI', 0.39953, 135],
    ['SCHD', 0.2604, 40],
    ['JEPI', 0.35772, 135],
    ['VZ', 0.6775, 30],
    ['NVO', 0.41155, 64],
    ['JEPI', 0.36826, 135],
    ['SCHD', 0.2604, 40],
    ['JEPI', 0.36102, 135],
    ['JEPI', 0.34636, 135],
    ['VZ', 0.69, 30],
    ['PG', 1.057, 10],
    ['JEPI', 0.3706, 135],
    ['SCHD', 0.2782, 40],
    ['JEPI', 0.42709, 135],
    ['JEPI', 0.34443, 135],
    ['VZ', 0.69, 50],
    ['PG', 1.057, 10],
    ['JEPI', 0.35134, 135],
    ['SCHD', 0.2569, 40],
    ['QCOM', 0.89, 2],
    ['UNH', 2.21, 8],
    ['V', 0.67, 3],
    ['NVO', 0.87369, 112],
    ['JEPI', 0.4205, 135],
    ['JEPI', 0.44761, 135],
    ['VZ', 0.7075, 50],
    ['PG', 1.089, 15],
    ['JEPI', 0.38921, 145],
    ['QCOM', 0.92, 2],
    ['UNH', 2.32, 8],
    ['UPS', 1.64, 10],
    ['V', 0.67, 3],
    ['JEPI', 0.38716, 145],
  ];

  const calculatedTotal = receiptFixtures.reduce((sum, [ticker, perShare, quantity], index) => {
    const [row] = buildAutoDividendRows({
      asset: {
        id: `photo-${index}`,
        name: ticker,
        ticker,
        category: '해외주식',
        currency: 'USD',
        originalCurrency: 'USD',
        quantity,
        buyDate: '2025-01-01',
      },
      dividends: {
        one: { date: toTimestamp('2026-01-15'), amount: perShare },
      },
    });
    return sum + row.amount;
  }, 0);

  assert.ok(Math.abs(calculatedTotal - 942.81) < 0.10);
});

test('매수일과 원장이 없는 보유 수량으로 과거 국내 배당을 추정하지 않는다', () => {
  const tataRows = buildAutoDividendRows({
    asset: {
      id: 91,
      name: 'KODEX 인도타타그룹',
      ticker: '477730',
      category: '국내주식',
      currency: 'KRW',
      quantity: 32,
      buyDate: '',
    },
    dividends: {
      older: { date: toTimestamp('2026-01-29'), amount: 10 },
      latest: { date: toTimestamp('2026-04-29'), amount: 35 },
    },
  });
  const niftyRows = buildAutoDividendRows({
    asset: {
      id: 92,
      name: 'TIGER 인도니프티50',
      ticker: '453870',
      category: '국내주식',
      currency: 'KRW',
      quantity: 36,
      buyDate: '',
    },
    dividends: {
      older: { date: toTimestamp('2026-01-29'), amount: 40 },
      latest: { date: toTimestamp('2026-04-29'), amount: 15 },
    },
  });

  assert.equal(tataRows.length, 0);
  assert.equal(niftyRows.length, 0);
});

test('legacy quantity fallback reverses later sells from the current position', () => {
  const asset = {
    id: 93,
    name: 'Legacy holding',
    ticker: 'LEGACY',
    quantity: 32,
    buyDate: '',
  };
  const ledger = [
    { assetId: 93, ticker: 'LEGACY', side: 'sell', quantity: 8, date: '2026-05-15' },
  ];

  assert.equal(getHeldQuantityOnExDate(
    asset,
    ledger,
    '2026-04-29',
    { allowCurrentQuantityFallback: true },
  ), 40);
});

test('이전된 시작 잔고의 매수일보다 앞선 배당을 소급 생성하지 않는다', () => {
  const asset = {
    id: 94,
    name: 'KODEX 인도타타그룹',
    ticker: '477730',
    category: '국내주식',
    currency: 'KRW',
    quantity: 32,
    buyDate: '2026-07-01',
  };
  const rows = buildAutoDividendRows({
    asset,
    ledger: [{
      assetId: 94,
      sourceId: 'asset-94',
      ticker: '477730',
      side: 'buy',
      quantity: 32,
      date: '2026-07-01',
    }],
    dividendStartDate: '2026-07-01',
    dividends: {
      older: { date: toTimestamp('2026-01-29'), amount: 10 },
      latest: { date: toTimestamp('2026-04-29'), amount: 35 },
    },
  });

  assert.equal(rows.length, 0);
});

test('a verified buy after the ex-date does not create an unearned dividend', () => {
  const asset = {
    id: 95,
    name: 'Verified new holding',
    ticker: '477730',
    category: '국내주식',
    currency: 'KRW',
    quantity: 32,
    buyDate: '2026-07-01',
  };
  const rows = buildAutoDividendRows({
    asset,
    ledger: [{
      assetId: 95,
      sourceId: 'manual-buy-95',
      ticker: '477730',
      side: 'buy',
      quantity: 32,
      date: '2026-07-01',
    }],
    dividendStartDate: '2026-07-01',
    dividends: {
      latest: { date: toTimestamp('2026-04-29'), amount: 35 },
    },
  });

  assert.equal(rows.length, 0);
});

test('국내 상장 인도 ETF는 과표증분 미입력 시 세전 분배금을 표시한다', () => {
  const tataRows = buildAutoDividendRows({
    asset: {
      id: 10,
      name: 'KODEX 인도타타그룹',
      ticker: '477730',
      category: '국내주식',
      currency: 'KRW',
      quantity: 32,
      buyDate: '2026-02-01',
      dividendTaxRate: 0.154,
    },
    dividendStartDate: '2026-02-01',
    dividends: {
      one: { date: toTimestamp('2026-04-29'), amount: 35 },
    },
  });
  const niftyRows = buildAutoDividendRows({
    asset: {
      id: 11,
      name: 'TIGER 인도니프티50',
      ticker: '453870',
      category: '국내주식',
      currency: 'KRW',
      quantity: 36,
      buyDate: '2026-02-01',
      dividendTaxRate: 0.154,
    },
    dividendStartDate: '2026-02-01',
    dividends: {
      one: { date: toTimestamp('2026-04-29'), amount: 15 },
    },
  });

  assert.equal(tataRows[0].grossAmount, 1120);
  assert.equal(tataRows[0].taxAmount, 0);
  assert.equal(tataRows[0].amount, 1120);
  assert.equal(tataRows[0].taxCalculationMode, 'tax-basis');
  assert.equal(tataRows[0].recordType, 'estimate');
  assert.equal(tataRows[0].calculationFormula, '35원 × 32주 = 1,120원');
  assert.equal(niftyRows[0].grossAmount, 540);
  assert.equal(niftyRows[0].amount, 540);
  assert.equal(niftyRows[0].taxCalculationMode, 'tax-basis');
  assert.equal(niftyRows[0].recordType, 'estimate');
  assert.equal(niftyRows[0].calculationFormula, '15원 × 36주 = 540원');
});

test('동일 종목도 주당 분배금과 배당락일 보유수량이 바뀌면 계산 결과가 함께 바뀐다', () => {
  const rows = buildAutoDividendRows({
    asset: {
      id: 10,
      name: 'KODEX 인도타타그룹',
      ticker: '477730',
      category: '국내주식',
      currency: 'KRW',
      quantity: 40,
      buyDate: '2026-02-01',
      dividendTaxRate: 0.154,
    },
    dividendStartDate: '2026-02-01',
    dividends: {
      one: { date: toTimestamp('2026-04-29'), amount: 20 },
    },
  });

  assert.equal(rows[0].grossAmount, 800);
  assert.equal(rows[0].amount, 800);
  assert.equal(rows[0].calculationFormula, '20원 × 40주 = 800원');
});

test('국내 상장 해외 ETF는 세율을 입력해도 분배금 전체에 세율을 곱하지 않는다', () => {
  const profile = getAssetDividendProfile({
    name: 'TIGER 인도니프티50',
    ticker: '453870',
    category: '국내주식',
    currency: 'KRW',
    dividendTaxRate: 0.154,
    dividendTaxRateExplicit: true,
  });

  assert.equal(profile.dividendTaxRate, 0.154);
  assert.equal(profile.taxCalculationMode, 'tax-basis');
  assert.equal(profile.dividendTaxBasisPerShare, 0);
});

test('국내 상장 해외 ETF는 입력한 과표증분에만 세금을 계산한다', () => {
  const rows = buildAutoDividendRows({
    asset: {
      id: 12,
      name: 'ACE 인도컨슈머파워액티브',
      ticker: '453810',
      category: '국내주식',
      currency: 'KRW',
      quantity: 10,
      buyDate: '2026-01-01',
      dividendTaxRate: 0.154,
      dividendTaxRateExplicit: true,
      dividendTaxBasisPerShare: 4,
    },
    dividendStartDate: '2026-01-01',
    dividends: {
      one: { date: toTimestamp('2026-04-29'), amount: 20 },
    },
  });

  assert.equal(rows[0].grossAmount, 200);
  assert.equal(rows[0].taxAmount, 6.16);
  assert.equal(rows[0].amount, 193.84);
  assert.equal(rows[0].taxCalculationMode, 'tax-basis');
});

test('자동 저장된 0% 값은 국내 상장 해외 ETF의 과표 확인 상태를 유지한다', () => {
  const profile = getAssetDividendProfile({
    name: 'KODEX 인도타타그룹',
    ticker: '477730',
    category: '국내주식',
    currency: 'KRW',
    dividendTaxRate: 0,
    dividendTaxRateExplicit: false,
  });

  assert.equal(profile.dividendTaxRate, 0.154);
  assert.equal(profile.taxCalculationMode, 'tax-basis');
});

test('기존 자동 배당 행도 새 ETF 과표 계산 방식으로 다시 계산한다', () => {
  const recalculated = recalculateEstimatedDividendRow({
    id: 'legacy',
    name: 'KODEX 인도타타그룹',
    ticker: '477730',
    quantity: 32,
    perShareGrossAmount: 35,
    grossAmount: 1120,
    taxAmount: 172.48,
    amount: 947.52,
    currency: 'KRW',
  }, {
    name: 'KODEX 인도타타그룹',
    ticker: '477730',
    category: '국내주식',
    currency: 'KRW',
    dividendTaxRate: 0.154,
  });

  assert.equal(recalculated.taxAmount, 0);
  assert.equal(recalculated.amount, 1120);
  assert.equal(recalculated.status, 'estimated');
  assert.equal(recalculated.recordType, 'estimate');
});

test('자동 계산 입력값이 있는 저장 행은 과거 상태값과 무관하게 공식으로 다시 산출한다', () => {
  const tata = recalculateEstimatedDividendRow({
    id: 'legacy-tata',
    date: '2026-04-29',
    name: 'KODEX 인도타타그룹',
    ticker: '477730',
    quantity: 40,
    perShareGrossAmount: 20,
    grossAmount: 1120,
    taxAmount: 172.48,
    amount: 1120,
    status: 'paid',
    recordType: 'actual',
    confirmationSource: 'user-confirmed',
    currency: 'KRW',
  }, {
    id: 477730,
    name: 'KODEX 인도타타그룹',
    ticker: '477730',
    category: '국내주식',
    currency: 'KRW',
  });
  const nifty = recalculateEstimatedDividendRow({
    id: 'legacy-nifty',
    exDate: '2026-04-29',
    name: 'TIGER 인도니프티50',
    ticker: '453870',
    quantity: 10,
    perShareGrossAmount: 25,
    grossAmount: 540,
    taxAmount: 83.16,
    amount: 540,
    status: 'confirmed',
    recordType: 'actual',
    confirmationSource: 'user-confirmed',
    currency: 'KRW',
  }, {
    id: 453870,
    name: 'TIGER 인도니프티50',
    ticker: '453870.KS',
    category: '국내주식',
    currency: 'KRW',
  });

  assert.equal(tata.grossAmount, 800);
  assert.equal(tata.amount, 800);
  assert.equal(tata.taxAmount, 0);
  assert.equal(tata.status, 'estimated');
  assert.equal(tata.recordType, 'estimate');
  assert.equal(tata.confirmationSource, '');
  assert.equal(tata.calculationFormula, '20원 × 40주 = 800원');
  assert.equal(nifty.grossAmount, 250);
  assert.equal(nifty.amount, 250);
  assert.equal(nifty.taxAmount, 0);
  assert.equal(nifty.status, 'estimated');
  assert.equal(nifty.recordType, 'estimate');
  assert.equal(nifty.confirmationSource, '');
  assert.equal(nifty.calculationFormula, '25원 × 10주 = 250원');
});

test('주당 배당금과 배당락일 수량으로 계산된 행만 집계 대상으로 인정한다', () => {
  assert.equal(isVerifiableDividendRecord({
    amount: 800,
    quantity: 40,
    perShareGrossAmount: 20,
    calculationSource: 'market-dividend-per-share',
    calculationValid: true,
  }), true);

  assert.equal(isVerifiableDividendRecord({
    amount: 10196,
    currency: 'KRW',
    status: 'estimated',
  }), false);
});

test('사진에서 확인한 2025년 이후 배당 입금 기록을 통화별로 정확히 합산한다', () => {
  const usdReceipts = [
    ['2025-10', 'JEPI', 41.43],
    ['2025-09', 'SCHD', 8.85],
    ['2025-09', 'JEPI', 42.26],
    ['2025-08', 'NVD', 19.20],
    ['2025-08', 'JEPI', 41.06],
    ['2025-08', 'VZ', 17.27],
    ['2025-07', 'JEPI', 45.85],
    ['2025-07', 'SCHD', 8.85],
    ['2025-06', 'JEPI', 61.96],
    ['2026-02', 'PG', 8.98],
    ['2026-02', 'JEPI', 39.52],
    ['2026-02', 'VZ', 29.33],
    ['2026-01', 'JEPI', 49.01],
    ['2025-12', 'SCHD', 9.46],
    ['2025-12', 'JEPI', 42.54],
    ['2025-11', 'PG', 8.98],
    ['2025-11', 'JEPI', 39.75],
    ['2025-11', 'VZ', 17.59],
    ['2026-04', 'NVO', 71.40],
    ['2026-04', 'JEPI', 48.24],
    ['2026-03', 'SCHD', 8.73],
    ['2026-03', 'QCOM', 1.51],
    ['2026-03', 'UNH', 15.03],
    ['2026-03', 'JEPI', 40.32],
    ['2026-03', 'V', 1.71],
    ['2026-07', 'JEPI', 47.72],
    ['2026-06', 'QCOM', 1.56],
    ['2026-06', 'UNH', 15.78],
    ['2026-06', 'UPS', 13.94],
    ['2026-06', 'JEPI', 47.96],
    ['2026-06', 'V', 1.71],
    ['2026-05', 'PG', 13.88],
    ['2026-05', 'JEPI', 51.36],
    ['2026-05', 'VZ', 30.07],
  ].map(([period, ticker, amount], index) => ({
    id: `photo-usd-${index + 1}`,
    period,
    date: `${period}-01`,
    name: ticker,
    ticker,
    amount,
    currency: 'USD',
    status: 'actual',
    recordType: 'actual',
    confirmationSource: 'user-photo-record',
  }));

  const krwReceipts = [
    ['477730', 'KODEX 인도타타그룹', 1120],
    ['453870', 'TIGER 인도니프티50', 540],
  ].map(([ticker, name, amount], index) => ({
    id: `photo-krw-${index + 1}`,
    period: '2026-04',
    date: '2026-04-01',
    name,
    ticker,
    amount,
    currency: 'KRW',
    status: 'actual',
    recordType: 'actual',
    confirmationSource: 'user-photo-record',
  }));

  const reported = selectReportedDividendRecords([
    {
      id: 'automatic-placeholder',
      name: 'JEPI',
      amount: 9999,
      currency: 'USD',
      quantity: 1,
      perShareGrossAmount: 9999,
      calculationSource: 'market-dividend-per-share',
      calculationValid: true,
    },
  ], [...usdReceipts, ...krwReceipts]);

  const usdTotal = reported
    .filter((record) => record.currency === 'USD')
    .reduce((sum, record) => sum + record.amount, 0);
  const krwTotal = reported
    .filter((record) => record.currency === 'KRW')
    .reduce((sum, record) => sum + record.amount, 0);

  assert.equal(reported.length, 36);
  assert.equal(Number(usdTotal.toFixed(2)), 942.81);
  assert.equal(krwTotal, 1660);
});

test('배당 종목군은 전량 매도한 종목도 거래 원장에서 복원한다', () => {
  const universe = buildDividendAssetUniverse(
    [{ id: 1, name: 'JEPI', ticker: 'JEPI', category: '해외주식', currency: 'USD', quantity: 10 }],
    [
      { id: 'qcom-buy', name: 'QCOM', ticker: 'QCOM', side: 'buy', quantity: 2, price: 150, date: '2026-01-29', currency: 'USD' },
      { id: 'qcom-sell', name: 'QCOM', ticker: 'QCOM', side: 'sell', quantity: 2, price: 180, date: '2026-07-09', currency: 'USD' },
    ],
  );

  assert.equal(universe.length, 2);
  assert.equal(universe.filter((asset) => asset.ticker === 'JEPI').length, 1);
  const closedQcom = universe.find((asset) => asset.ticker === 'QCOM');
  assert.equal(closedQcom.quantity, 0);
  assert.equal(closedQcom.buyDate, '2026-01-29');
  assert.equal(closedQcom.isClosedPosition, true);
});

test('전량 매도 종목은 매도 전 배당만 계산한다', () => {
  const ledger = [
    { id: 'qcom-buy', name: 'QCOM', ticker: 'QCOM', side: 'buy', quantity: 2, price: 150, date: '2026-01-29', currency: 'USD' },
    { id: 'qcom-sell', name: 'QCOM', ticker: 'QCOM', side: 'sell', quantity: 2, price: 180, date: '2026-07-09', currency: 'USD' },
  ];
  const [asset] = buildDividendAssetUniverse([], ledger);
  const rows = buildAutoDividendRows({
    asset,
    ledger,
    dividends: {
      beforeSell: { date: toTimestamp('2026-06-04'), amount: 0.92 },
      afterSell: { date: toTimestamp('2026-07-10'), amount: 0.92 },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].grossAmount, 1.84);
  assert.equal(rows[0].amount, 1.564);
});

test('직접 확인한 해외 배당이 있어도 국내 ETF 자동 배당은 함께 유지한다', () => {
  const reported = selectReportedDividendRecords([
    {
      id: 'auto-india-etf',
      name: 'KODEX 인도타타그룹',
      ticker: '477730',
      date: '2026-04-29',
      exDate: '2026-04-29',
      amount: 1120,
      currency: 'KRW',
      quantity: 32,
      perShareGrossAmount: 35,
      calculationSource: 'market-dividend-per-share',
      calculationValid: true,
    },
  ], [
    {
      id: 'confirmed-jepi',
      name: 'JEPI',
      ticker: 'JEPI',
      period: '2026-04',
      amount: 48.24,
      currency: 'USD',
      status: 'actual',
      confirmationSource: 'user-receipt',
    },
  ]);

  assert.equal(reported.length, 2);
  assert.equal(reported.find((row) => row.ticker === '477730').amount, 1120);
});

test('직접 확인 기록이 있는 통화는 다른 종목의 자동 추정치를 합산하지 않는다', () => {
  const reported = selectReportedDividendRecords(
    [
      {
        id: 'auto-spy',
        name: 'SPY',
        ticker: 'SPY',
        amount: 1.62,
        currency: 'USD',
        quantity: 1,
        perShareGrossAmount: 1.9,
        calculationSource: 'market-dividend-per-share',
        calculationValid: true,
      },
      {
        id: 'auto-tata',
        name: 'KODEX 인도타타그룹',
        ticker: '477730',
        amount: 1120,
        currency: 'KRW',
        quantity: 32,
        perShareGrossAmount: 35,
        calculationSource: 'market-dividend-per-share',
        calculationValid: true,
      },
    ],
    [{
      id: 'receipt-jepi',
      name: 'JEPI',
      ticker: 'JEPI',
      amount: 47.72,
      currency: 'USD',
      status: 'actual',
      confirmationSource: 'user-photo-record',
    }],
  );

  assert.deepEqual(reported.map((row) => row.id).sort(), ['auto-tata', 'receipt-jepi']);
});

test('같은 종목·월의 직접 확인 배당은 자동 계산액과 중복 합산하지 않는다', () => {
  const reported = selectReportedDividendRecords([
    {
      id: 'auto-jepi',
      name: 'JEPI',
      ticker: 'JEPI',
      exDate: '2026-04-01',
      amount: 48.25,
      currency: 'USD',
      quantity: 135,
      perShareGrossAmount: 0.4205,
      calculationSource: 'market-dividend-per-share',
      calculationValid: true,
    },
  ], [
    {
      id: 'confirmed-jepi',
      name: 'JEPI',
      ticker: 'JEPI',
      period: '2026-04',
      amount: 48.24,
      currency: 'USD',
      status: 'actual',
      confirmationSource: 'user-receipt',
    },
  ]);

  assert.equal(reported.length, 1);
  assert.equal(reported[0].amount, 48.24);
  assert.equal(reported[0].confirmationSource, 'user-receipt');
});
