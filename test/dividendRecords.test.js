import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAutomaticDividendEventKey,
  isSameAutomaticDividendEvent,
  mergeAutomaticDividendRecords,
  selectFormulaDividendRecords,
  mergeDividendRecords,
  normalizeDividendValidationRecords,
  selectReceivedDividendRecords,
  selectReportedDividendRecords,
  selectUserEnteredDividendRecords,
  sortDividendRecordsNewestFirst,
} from '../src/utils/dividendRecords.js';

test('짧아진 새 배당 응답이 과거의 다른 지급 건을 삭제하지 않는다', () => {
  const previous = [
    { id: 'old-june', ticker: 'JEPI', exDate: '2026-06-01', paymentDate: '2026-06-03', amount: 47.97 },
    { id: 'old-july', ticker: 'JEPI', exDate: '2026-07-01', paymentDate: '2026-07-06', amount: 47.72 },
  ];
  const refreshed = [
    { id: 'new-july', ticker: 'JEPI', exDate: '2026-07-01', paymentDate: '2026-07-06', amount: 47.71747 },
  ];

  const result = mergeAutomaticDividendRecords(refreshed, previous);

  assert.deepEqual(result.map((row) => row.id).sort(), ['new-july', 'old-june']);
});

test('자산 ID가 바뀌어도 같은 종목·배당락일은 한 지급 건으로 병합한다', () => {
  const result = mergeAutomaticDividendRecords(
    [{ id: 'new', assetId: 'new-asset', ticker: 'VZ', exDate: '2026-07-10', amount: 30.06875 }],
    [{ id: 'old', assetId: 'old-asset', ticker: 'VZ', exDate: '2026-07-10', amount: 30.06 }],
  );

  assert.deepEqual(result.map((row) => row.id), ['new']);
});

test('official payment replaces the provisional row for the same dividend cycle', () => {
  const result = mergeAutomaticDividendRecords(
    [{
      id: 'official',
      ticker: '453810',
      exDate: '2026-07-31',
      paymentDate: '2026-08-04',
      amount: 9120,
      calculationSource: 'kodex',
    }],
    [{
      id: 'provisional',
      ticker: '453810',
      exDate: '2026-07-30',
      paymentDate: '2026-07-30',
      amount: 7716,
      calculationSource: 'market-dividend-feed',
    }],
  );

  assert.deepEqual(result.map((row) => row.id), ['official']);
});

test('load migration collapses already stored official and provisional rows', () => {
  const result = mergeAutomaticDividendRecords([
    {
      id: 'provisional',
      ticker: '477730',
      exDate: '2026-07-30',
      amount: 5634,
      calculationSource: 'market-dividend-feed',
    },
    {
      id: 'official',
      ticker: '477730',
      exDate: '2026-07-31',
      paymentDate: '2026-08-04',
      amount: 6660,
      calculationSource: 'kodex',
    },
  ], []);

  assert.deepEqual(result.map((row) => row.id), ['official']);
});

test('원천에는 있지만 보유수량이 0인 지급 건만 명시적으로 제거한다', () => {
  const gev = { id: 'gev-old', ticker: 'GEV', exDate: '2026-06-16', paymentDate: '2026-07-14', amount: 0.425 };
  const result = mergeAutomaticDividendRecords([], [gev], {
    invalidatedEventKeys: [getAutomaticDividendEventKey(gev)],
  });

  assert.equal(result.length, 0);
});

test('잘못 연결된 453870 사진 검증 행은 다른 티커로 추정하지 않고 미분류로 돌린다', () => {
  const [result] = normalizeDividendValidationRecords([{
    id: 'photo-krw-2',
    ticker: '453870',
    name: 'TIGER 인도니프티50',
    amount: 540,
    confirmationSource: 'user-photo-record',
  }]);

  assert.equal(result.ticker, '');
  assert.equal(result.validationStatus, 'unassigned');
  assert.equal(result.amount, 540);
});

test('홈페이지 합계용 선택기는 계산식 행만 받고 삭제된 계산 행은 제외한다', () => {
  const result = selectFormulaDividendRecords([
    { id: 'formula', ticker: 'JEPI', paymentDate: '2026-07-01', amount: 47.72 },
    { id: 'deleted-formula', ticker: 'GEV', paymentDate: '2026-07-14', amount: 0.42, status: 'deleted' },
  ]);

  assert.deepEqual(result.map((row) => row.id), ['formula']);
});

test('사진 검증값은 제외하고 화면에서 직접 입력한 실입금만 합계 후보로 선택한다', () => {
  const result = selectUserEnteredDividendRecords([
    { id: 'photo', amount: 100, date: '2026-08-01', confirmationSource: 'user-photo-record' },
    { id: 'manual', amount: 90, date: '2026-08-01', confirmationSource: 'user-entry' },
  ]);

  assert.deepEqual(result.map((row) => row.id), ['manual']);
});

test('JEPI처럼 월별 내역이 섞여 들어와도 지급일 최신순으로 정렬한다', () => {
  const result = sortDividendRecordsNewestFirst([
    { id: 'july', ticker: 'JEPI', paymentDate: '2026-07-01' },
    { id: 'may', ticker: 'JEPI', paymentDate: '2026-05-01' },
    { id: 'august', ticker: 'JEPI', paymentDate: '2026-08-03' },
  ]);

  assert.deepEqual(result.map((row) => row.id), ['august', 'july', 'may']);
});

test('같은 종목·같은 지급월은 실제 입금액이 자동 계산값을 대체한다', () => {
  const automatic = [
    { id: 'jepi-auto', ticker: 'JEPI', name: 'JEPI', paymentDate: '2026-07-01', currency: 'USD', amount: 90 },
    { id: 'spy-auto', ticker: 'SPY', name: 'SPDR S&P 500', paymentDate: '2026-07-31', currency: 'USD', amount: 1.6179886 },
  ];
  const confirmed = [
    { id: 'jepi-actual', ticker: 'JEPI', name: 'JEPI', period: '2026-07', date: '2026-07-01', currency: 'USD', amount: 47.72, status: 'actual' },
  ];

  const result = selectReportedDividendRecords(automatic, confirmed);

  assert.deepEqual(result.map((row) => row.id).sort(), ['jepi-actual', 'spy-auto']);
  assert.ok(Math.abs(result.reduce((sum, row) => sum + row.amount, 0) - 49.3379886) < 0.0000001);
});

test('공식 월말 지급과 다음 달 실제 입금 기록의 금액이 같으면 중복 합산하지 않는다', () => {
  const automatic = [
    { id: 'pg-auto', ticker: 'PG', paymentDate: '2026-04-24', currency: 'USD', amount: 13.88475 },
  ];
  const confirmed = [
    { id: 'pg-actual', ticker: 'PG', period: '2026-05', date: '2026-05-01', currency: 'USD', amount: 13.88 },
  ];

  const result = selectReportedDividendRecords(automatic, confirmed);

  assert.deepEqual(result.map((row) => row.id), ['pg-actual']);
});

test('기존 실제 입금 합계와 SPY·VZ를 합산하면 약 974.5달러다', () => {
  const confirmedTotal = 942.81;
  const spyNet = 1.903516 * 0.85;
  const vzNet = 0.7075 * 50 * 0.85;

  assert.ok(Math.abs((confirmedTotal + spyNet + vzNet) - 974.4967386) < 0.0000001);
});

test('JEPI 표시 행의 합계는 반올림 전 684.1552675달러이고 화면에는 684.16달러다', () => {
  const throughJuly = 609.1318875;
  const correctedJuneEntitlementDifference = (0.54 * (135 - 70)) * 0.85;
  const august = 0.36664 * 145 * 0.85;
  const total = throughJuly + correctedJuneEntitlementDifference + august;

  assert.ok(Math.abs(total - 684.1552675) < 0.0000001);
  assert.equal(total.toFixed(2), '684.16');
});

test('실제 입금 합계에는 확인되지 않은 GEV 자동 계산분을 넣지 않는다', () => {
  const rows = selectReceivedDividendRecords([
    { id: 'actual', ticker: 'SPY', amount: 1.62, currency: 'USD', date: '2026-08-01', status: 'confirmed' },
    { id: 'automatic', ticker: 'GEV', amount: 0.425, currency: 'USD', paymentDate: '2026-07-14' },
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['actual']);
});

test('공식 지급일이 지난 보유수량 검증 계산분은 홈페이지 합계에 포함한다', () => {
  const rows = selectReceivedDividendRecords([
    { id: 'nifty', ticker: '453810', amount: 9120, currency: 'KRW', paymentDate: '2026-08-04', entitlementVerified: true },
    { id: 'tata', ticker: '477730', amount: 6660, currency: 'KRW', paymentDate: '2026-08-04', entitlementVerified: true },
  ], '2026-08-04');

  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 15780);
});

test('지급일이 없는 해외 배당락일 추정치는 입금 합계에 포함하지 않는다', () => {
  const rows = selectReceivedDividendRecords([
    { id: 'foreign', ticker: 'TEST', amount: 0.75, currency: 'USD', date: '2026-07-30', entitlementVerified: true },
  ], '2026-08-04');

  assert.equal(rows.length, 0);
});

test('국내 배당은 지급일이 없어도 검증된 배당락일이 지나면 입금 합계에 포함한다', () => {
  const rows = selectReceivedDividendRecords([
    { id: 'tiger', ticker: '277630', amount: 862.92, currency: 'KRW', date: '2026-07-30', entitlementVerified: true },
  ], '2026-08-04');

  assert.equal(rows.length, 1);
});

test('빈 원격 배열을 병합해도 로컬 실제 배당 내역이 사라지지 않는다', () => {
  const local = Array.from({ length: 36 }, (_, index) => ({
    id: `actual-${index}`,
    ticker: 'JEPI',
    date: '2026-01-01',
    amount: index + 1,
    currency: 'USD',
    status: 'actual',
  }));

  assert.equal(mergeDividendRecords(local, []).length, 36);
});

test('삭제 tombstone은 다른 기기의 오래된 기록보다 우선하고 합계에서 제외된다', () => {
  const active = { id: 'actual-1', ticker: 'VZ', date: '2026-05-01', amount: 30.07, status: 'actual' };
  const deleted = { ...active, status: 'deleted', deletedAt: '2026-08-04T01:00:00.000Z' };
  const merged = mergeDividendRecords([deleted], [active]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'deleted');
  assert.equal(selectReceivedDividendRecords(merged).length, 0);
});

test('계좌 유형이 다르면 같은 종목·같은 배당락일이라도 한 건으로 합치지 않는다', () => {
  const isaRow = {
    ticker: '453810', name: 'KODEX', exDate: '2026-07-31', currency: 'KRW',
    accountType: 'ISA', amount: 9120, quantity: 100,
  };
  const generalRow = {
    ...isaRow, accountType: 'GENERAL', amount: 4560, quantity: 50,
  };

  assert.equal(isSameAutomaticDividendEvent(isaRow, generalRow), false);
  assert.equal(isSameAutomaticDividendEvent(isaRow, { ...isaRow, amount: 1 }), true);
});

test('계좌가 다른 같은 배당 이벤트는 병합에서 한쪽이 사라지지 않는다', () => {
  const isaRow = {
    ticker: '069500', name: 'KODEX200', round: 1, exDate: '2026-05-01',
    currency: 'KRW', accountType: 'ISA', amount: 1000,
  };
  const generalRow = { ...isaRow, accountType: 'GENERAL', amount: 500 };

  const merged = mergeAutomaticDividendRecords([isaRow, generalRow], []);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((record) => record.accountType).sort(),
    ['GENERAL', 'ISA'],
  );
});
