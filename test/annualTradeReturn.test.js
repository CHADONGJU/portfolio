import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAnnualTradeReturn,
  getAnnualTradeYears,
} from '../src/utils/annualTradeReturn.js';
import { buildCanonicalTradeRows } from '../src/utils/tradeReconciliation.js';

const resolveBuyRate = (record) => {
  const currency = record?.currency || 'KRW';
  if (currency === 'KRW') return 1;
  const stored = Number(record?.fxRate);
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
};

test('매도분 매수원가 대비 실현손익으로 수익률을 낸다', () => {
  const rows = buildCanonicalTradeRows({
    tradeLedger: [
      { id: 'b1', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'buy', date: '2026-01-05', quantity: 10, price: 100000 },
      { id: 's1', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'sell', date: '2026-06-05', quantity: 5, price: 120000 },
    ],
    resolveKrwRate: resolveBuyRate,
  });

  const result = calculateAnnualTradeReturn({ rows, year: 2026 });

  assert.equal(result.status, 'ready');
  assert.equal(result.buyKRW, 1000000);
  assert.equal(result.sellKRW, 600000);
  assert.equal(result.profitKRW, 100000);
  // 매도분 매수원가 = 600,000 − 100,000 = 500,000 → 100,000 ÷ 500,000 = 20%
  assert.equal(result.soldCostKRW, 500000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 20);
  assert.equal(result.approximate, false);
});

test('매매가 없는 해는 empty로 표시한다', () => {
  const result = calculateAnnualTradeReturn({ rows: [], year: 2026 });
  assert.equal(result.status, 'empty');
  assert.equal(result.returnPercent, null);
  assert.equal(result.tradeCount, 0);
});

test('전년도에 산 것을 올해 팔아도 매도분 매수원가로 계산된다', () => {
  const rows = buildCanonicalTradeRows({
    tradeLedger: [
      { id: 'b1', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'buy', date: '2025-11-05', quantity: 10, price: 100000 },
      { id: 's1', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'sell', date: '2026-03-05', quantity: 10, price: 110000 },
    ],
    resolveKrwRate: resolveBuyRate,
  });

  const result = calculateAnnualTradeReturn({ rows, year: 2026 });

  assert.equal(result.status, 'ready');
  assert.equal(result.buyKRW, 0);
  assert.equal(result.sellKRW, 1100000);
  assert.equal(result.profitKRW, 100000);
  // 분모 = 매도분 매수원가 1,000,000 → 10%
  assert.equal(result.soldCostKRW, 1000000);
  assert.equal(Math.round(result.returnPercent * 100) / 100, 10);
});

test('외화 매매는 시점 환율(fxRate)로 환산하고 krwPnl을 그대로 쓴다', () => {
  const rows = buildCanonicalTradeRows({
    tradeLedger: [
      { id: 'b1', name: 'ETF', ticker: 'SPY', currency: 'USD', side: 'buy', date: '2026-01-05', quantity: 10, price: 100, fxRate: 1300 },
      { id: 's1', name: 'ETF', ticker: 'SPY', currency: 'USD', side: 'sell', date: '2026-06-05', quantity: 10, price: 110, fxRate: 1400 },
    ],
    resolveKrwRate: resolveBuyRate,
  });

  const result = calculateAnnualTradeReturn({ rows, year: 2026, exchangeRate: 9999 });

  // 매수: 10×100×1300, 매도: 10×110×1400 — 오늘 환율(9999)이 아니라 기록된 환율.
  assert.equal(result.buyKRW, 1300000);
  assert.equal(result.sellKRW, 1540000);
  // krwPnl은 매수 시점 환율 기준(환차손익 미포함 정책): (110-100)×10×1300 = 130,000
  assert.equal(result.profitKRW, 130000);
  // 매도분 매수원가 = 1,540,000 − 130,000 = 1,410,000
  assert.equal(result.soldCostKRW, 1410000);
  assert.equal(result.approximate, false);
});

test('시점 환율이 없는 옛 매도 기록은 오늘 환율로 근사하고 approximate로 표시한다', () => {
  const rows = [
    { side: 'sell', date: '2025-05-01', currency: 'USD', quantity: 10, price: 110, pnl: 100, krwPnl: null },
  ];

  const result = calculateAnnualTradeReturn({ rows, year: 2025, exchangeRate: 1400 });

  assert.equal(result.profitKRW, 140000);
  assert.equal(result.approximate, true);
});

test('연도 목록은 매매 기록의 연도와 올해를 내림차순으로 합친다', () => {
  const years = getAnnualTradeYears({
    rows: [
      { date: '2024-03-01' },
      { date: '2026-01-05' },
      { date: '' },
    ],
    currentYear: 2026,
  });

  assert.deepEqual(years, [2026, 2024]);
});

test('다른 해의 매매는 섞이지 않는다', () => {
  const rows = buildCanonicalTradeRows({
    tradeLedger: [
      { id: 'b1', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'buy', date: '2025-01-05', quantity: 10, price: 100000 },
      { id: 's1', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'sell', date: '2025-06-05', quantity: 10, price: 90000 },
      { id: 'b2', name: '삼성전자', ticker: '005930', currency: 'KRW', side: 'buy', date: '2026-02-05', quantity: 10, price: 100000, round: 2 },
    ],
    resolveKrwRate: resolveBuyRate,
  });

  const y2025 = calculateAnnualTradeReturn({ rows, year: 2025 });
  const y2026 = calculateAnnualTradeReturn({ rows, year: 2026 });

  assert.equal(y2025.profitKRW, -100000);
  assert.equal(Math.round(y2025.returnPercent * 100) / 100, -10);

  assert.equal(y2026.buyKRW, 1000000);
  assert.equal(y2026.profitKRW, 0);
  // 매수만 있고 매도가 없는 해는 확정된 손익이 없으므로 수익률을 만들지 않는다.
  assert.equal(y2026.returnPercent, null);
  assert.equal(y2026.status, 'empty');
});
