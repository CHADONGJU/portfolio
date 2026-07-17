import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutoDividendRows,
  getAssetDividendProfile,
  getHeldQuantityOnExDate,
  recalculateEstimatedDividendRow,
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

test('NVO는 덴마크 원천세와 ADR 수수료를 적용한다', () => {
  const profile = getAssetDividendProfile({
    ticker: 'NVO',
    category: '해외주식',
    currency: 'USD',
  });

  assert.equal(profile.sourceCountry, 'DK');
  assert.equal(profile.dividendTaxRate, 0.27);
  assert.equal(profile.adrFeePerShare, 0.015);
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

test('NVO 자동 배당은 27% 세금과 주당 ADR 수수료를 차감한다', () => {
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
  assert.ok(Math.abs(rows[0].amount - 73.2658984) < 0.000001);
  assert.ok(Math.abs(rows[0].perShareNetAmount - 0.91582373) < 0.000001);
  assert.equal(rows[0].recordDate, '2026-03-31');
  assert.equal(rows[0].paymentDate, '2026-04-07');
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
  assert.equal(niftyRows[0].grossAmount, 540);
  assert.equal(niftyRows[0].amount, 540);
});

test('국내 상장 해외 ETF도 사용자가 세율을 명시하면 해당 세율을 적용한다', () => {
  const profile = getAssetDividendProfile({
    name: 'TIGER 인도니프티50',
    ticker: '453870',
    category: '국내주식',
    currency: 'KRW',
    dividendTaxRate: 0.154,
    dividendTaxRateExplicit: true,
  });

  assert.equal(profile.dividendTaxRate, 0.154);
  assert.equal(profile.taxCalculationMode, 'rate');
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

  assert.equal(profile.dividendTaxRate, 0);
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
