import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSellCosts,
  deriveFeeRatePercent,
  formatFeeRateInput,
  getBrokerFeeRatePercent,
  getDomesticStockSellTaxRatePercent,
  getSellTaxRatePercent,
  resolveKnownFeeAmount,
} from '../src/utils/tradeCosts.js';

test('국내주식 제세금율은 매도일 기준으로 계산한다', () => {
  assert.equal(getDomesticStockSellTaxRatePercent('2023-12-29'), 0.2);
  assert.equal(getDomesticStockSellTaxRatePercent('2024-12-30'), 0.18);
  assert.equal(getDomesticStockSellTaxRatePercent('2025-12-26'), 0.15);
  assert.equal(getDomesticStockSellTaxRatePercent('2025-12-29'), 0.2);
  assert.equal(getDomesticStockSellTaxRatePercent('2026-08-22'), 0.2);
});

test('국내주식 매도 제세금은 매도금액 기준이고 손익과 무관하다', () => {
  const result = calculateSellCosts({
    category: '국내주식',
    quantity: 100,
    sellPrice: 51000,
    buyPrice: 60000,
    brokerFeeRatePercent: 0,
    sellTaxRatePercent: 0.2,
  });

  assert.equal(result.grossSellAmount, 5100000);
  assert.equal(result.sellTax, 10200);
  assert.equal(result.grossPnl, -900000);
  assert.equal(result.netPnl, -910200);
});

test('해외주식 매도 모달은 국내 제세금을 적용하지 않는다', () => {
  const asset = { category: '해외주식' };
  const result = calculateSellCosts({
    category: asset.category,
    quantity: 10,
    sellPrice: 120,
    buyPrice: 100,
    brokerFeeRatePercent: 0.25,
    sellTaxRatePercent: 0.2,
  });

  assert.equal(getSellTaxRatePercent(asset, '2026-08-22'), 0);
  assert.equal(result.sellTax, 0);
  assert.equal(result.brokerFee, 3);
  assert.equal(result.netPnl, 197);
});

test('국내 상장 ETF는 증권거래세 면제 대상이라 기본 제세금율이 0이다', () => {
  assert.equal(getSellTaxRatePercent({ category: '국내주식', name: 'KODEX 200' }, '2026-08-22'), 0);
  assert.equal(getSellTaxRatePercent({ category: '국내주식', name: 'TIGER 미국S&P500' }, '2026-08-22'), 0);
  assert.equal(getSellTaxRatePercent({ category: '국내주식', name: '삼성전자' }, '2026-08-22'), 0.2);
});

test('표에 없는 과거 매도일도 그 시절 세율로 계산한다', () => {
  assert.equal(getDomesticStockSellTaxRatePercent('2022-06-15'), 0.23);
  assert.equal(getDomesticStockSellTaxRatePercent('2021-01-04'), 0.23);
  assert.equal(getDomesticStockSellTaxRatePercent('2019-12-02'), 0.25);
  assert.equal(getDomesticStockSellTaxRatePercent('2015-03-02'), 0.3);
});

test('브랜드명이 앞에 붙은 이름만 ETF로 보고, 일반 종목은 거래세를 매긴다', () => {
  const domestic = (name) => getSellTaxRatePercent({ category: '국내주식', name }, '2026-08-22');
  assert.equal(domestic('BNK금융지주'), 0.2);
  assert.equal(domestic('파워로직스'), 0.2);
  assert.equal(domestic('SOLUM'), 0.2);
  assert.equal(domestic('SOL 미국배당다우존스'), 0);
  assert.equal(domestic('ACE 미국나스닥100'), 0);
  assert.equal(domestic('미래에셋 TIGER ETF'), 0);
});

test('증권거래세 인하는 2019-06-03 매매분부터 적용한다', () => {
  assert.equal(getDomesticStockSellTaxRatePercent('2019-06-02'), 0.3);
  assert.equal(getDomesticStockSellTaxRatePercent('2019-06-03'), 0.25);
});

test('프리셋 요율은 실제 유관기관제비용과 크게 다를 수 있다', () => {
  // 미래에셋 실계좌 대조: 5,274,000원 매도의 실제 수수료는 142원인데
  // 프리셋 요율(0.014%)로는 738원이 잡힌다. 그래서 금액 입력이 필요하다.
  const base = {
    category: '국내주식',
    currency: 'KRW',
    quantity: 60,
    sellPrice: 87_900,
    buyPrice: 81_900,
    sellTaxRatePercent: 0.2,
  };
  const preset = calculateSellCosts({
    ...base,
    brokerFeeRatePercent: getBrokerFeeRatePercent('miraeasset', '국내주식'),
  });
  assert.equal(preset.brokerFee, 738);

  const actual = calculateSellCosts({ ...base, brokerFeeAmount: 142 });
  assert.equal(actual.brokerFee, 142);
  assert.equal(actual.sellTax, 10_548);
  assert.equal(actual.netPnl, 349_310);
});

test('요율 입력칸이 소수점 여섯째 자리까지 남긴다', () => {
  // 유관기관제비용은 0.0027033% 처럼 소수점이 길다. 넷째 자리에서 자르면 어긋난다.
  assert.equal(formatFeeRateInput(0.0036396), '0.00364');
  assert.equal(formatFeeRateInput(0.0027033), '0.002703');
  assert.equal(formatFeeRateInput(0.015), '0.015');
  assert.equal(formatFeeRateInput(getBrokerFeeRatePercent('custom', '국내주식')), '0');
});

test('원화 수수료·제세금은 증권사처럼 원 단위로 절사한다', () => {
  const krw = calculateSellCosts({
    category: '국내주식',
    currency: 'KRW',
    quantity: 1,
    sellPrice: 5_274_000,
    buyPrice: 5_000_000,
    brokerFeeRatePercent: 0.0027033,
    sellTaxRatePercent: 0.2,
  });
  assert.equal(krw.brokerFee, 142); // 142.57 → 142
  assert.equal(Number.isInteger(krw.brokerFee), true);

  // 외화는 센트 단위로 부과되므로 절사하지 않는다.
  const usd = calculateSellCosts({
    category: '해외주식',
    currency: 'USD',
    quantity: 10,
    sellPrice: 120,
    buyPrice: 100,
    brokerFeeRatePercent: 0.25,
  });
  assert.equal(usd.brokerFee, 3);
  assert.equal(usd.netPnl, 197);

  const usdOdd = calculateSellCosts({
    category: '해외주식',
    currency: 'USD',
    quantity: 3,
    sellPrice: 111.11,
    buyPrice: 100,
    brokerFeeRatePercent: 0.25,
  });
  assert.ok(!Number.isInteger(usdOdd.brokerFee));
});

test('수수료를 금액으로 넣으면 요율보다 우선하고 증권사 화면과 정확히 맞는다', () => {
  // 미래에셋 실계좌 SK하이닉스: 3주 × 1,758,000, 수수료 142원, 세금 10,548원.
  const sk = calculateSellCosts({
    category: '국내주식',
    currency: 'KRW',
    quantity: 3,
    sellPrice: 1_758_000,
    buyPrice: 1_638_000,
    brokerFeeRatePercent: 0.014, // 무시돼야 한다
    brokerFeeAmount: 142,
    sellTaxRatePercent: 0.2,
  });
  assert.equal(sk.brokerFee, 142);
  assert.equal(sk.sellTax, 10_548);
  assert.equal(sk.netPnl, 349_310);
  // 매수 수수료 156원까지 빼면 증권사 손익금액과 같아진다.
  assert.equal(sk.netPnl - 156, 349_154);
  // 요율은 역산해 기록에 남긴다.
  assert.equal(Number(sk.feeRatePercent.toFixed(7)), 0.0026925);

  // 삼성전자: 25주 × 204,000, 수수료 162원, 세금 10,200원.
  const samsung = calculateSellCosts({
    category: '국내주식',
    currency: 'KRW',
    quantity: 25,
    sellPrice: 204_000,
    buyPrice: 160_000,
    brokerFeeAmount: 162,
    sellTaxRatePercent: 0.2,
  });
  assert.equal(samsung.brokerFee, 162);
  assert.equal(samsung.sellTax, 10_200);
  assert.equal(samsung.netPnl - 108, 1_089_530);
});

test('수수료 금액을 비워두면 예전처럼 요율로 계산한다', () => {
  const base = {
    category: '국내주식',
    currency: 'KRW',
    quantity: 3,
    sellPrice: 1_758_000,
    buyPrice: 1_638_000,
    brokerFeeRatePercent: 0.014,
    sellTaxRatePercent: 0.2,
  };
  assert.equal(calculateSellCosts(base).brokerFee, 738);
  assert.equal(calculateSellCosts({ ...base, brokerFeeAmount: null }).brokerFee, 738);
  assert.equal(calculateSellCosts({ ...base, brokerFeeAmount: '' }).brokerFee, 738);
  // 0원은 "수수료가 없었다"는 뜻이므로 그대로 존중한다.
  assert.equal(calculateSellCosts({ ...base, brokerFeeAmount: 0 }).brokerFee, 0);
});

test('빈 수수료 금액은 0원이 아니라 "아직 안 넣음"으로 본다', () => {
  assert.equal(resolveKnownFeeAmount(''), null);
  assert.equal(resolveKnownFeeAmount(null), null);
  assert.equal(resolveKnownFeeAmount(undefined), null);
  assert.equal(resolveKnownFeeAmount('abc'), null);
  assert.equal(resolveKnownFeeAmount(-5), null);
  // 직접 넣은 0은 "수수료가 없었다"는 뜻이라 그대로 존중한다.
  assert.equal(resolveKnownFeeAmount(0), 0);
  assert.equal(resolveKnownFeeAmount('142'), 142);
});

test('역산 요율은 기록된 수수료 금액을 설명할 수 있어야 한다', () => {
  // 요율은 참고용이다. 원 단위 절사 때문에 요율로 되돌리면 1원씩 어긋날 수 있어,
  // 어떤 코드도 이 요율로 수수료를 다시 계산하지 않는다(금액이 원본).
  const cases = [
    [142, 5_274_000],
    [162, 5_100_000],
    [156, 4_914_000],
    [108, 4_000_000],
    [738, 5_274_000],
  ];
  cases.forEach(([fee, amount]) => {
    const rate = deriveFeeRatePercent(fee, amount);
    assert.equal(Math.round(amount * (rate / 100)), fee);
  });

  assert.equal(deriveFeeRatePercent(0, 5_274_000), 0);
  assert.equal(deriveFeeRatePercent(142, 0), 0);
});
