import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTargetPortfolioFromHoldings, buildTargetPortfolioGuide, getTargetBudgetKRW,
  getTargetGroups, getTargetHoldingOptions, getTargetPlanIssues, normalizeTargetPercents, areTargetStocksSame,
} from '../src/utils/targetPortfolio.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
const makePlan = (items, groupPatch = {}, planPatch = {}) => ({
  budget: '1000000', categories: [{ id: '해외주식', percent: 100 }],
  groups: { 해외주식: [{ id: 'g', name: '기술주', allocationMode: 'percent', percent: 100, items, ...groupPatch }] },
  ...planPatch,
});
const guideFor = (targetPortfolio, enhancedAssets = [], extra = {}) => buildTargetPortfolioGuide({
  targetPortfolio, enhancedAssets, totalConvertedKRW: 1000000, exchangeRate: 1000, ...extra,
});

test('legacy relative item weights preserve target money and are adapted without changing saved data', () => {
  const plan = makePlan([{ id: 'a', name: 'A', percent: 30 }, { id: 'b', name: 'B', percent: 40 }], { allocationMode: undefined, percent: 60 });
  const original = structuredClone(plan);
  const groups = getTargetGroups(plan, '해외주식');
  assert.equal(groups[0].allocationMode, 'percent');
  close(groups[0].items[0].percent, 30 / 70 * 100);
  const guide = guideFor(plan);
  close(guide[0].groups[0].items[0].targetValue, 600000 * 30 / 70);
  close(guide[0].groups[0].items[1].targetValue, 600000 * 40 / 70);
  assert.deepEqual(plan, original);
  const savedAdaptedPlan = { ...plan, groups: { 해외주식: groups } };
  savedAdaptedPlan.groups.해외주식[0].items[0].percent = 20;
  assert.equal(getTargetGroups(savedAdaptedPlan, '해외주식')[0].items[0].percent, 20);
});

test('flat legacy items become a direct group and a sole relative weight remains the full allocation', () => {
  const plan = { budget: '', categories: [{ id: '국내주식', percent: 100 }], items: { 국내주식: [{ id: 'a', name: 'A', percent: 30 }] } };
  const group = getTargetGroups(plan, '국내주식')[0];
  assert.equal(group.isDefault, true);
  assert.equal(group.items[0].percent, 100);
  assert.equal(guideFor(plan)[0].groups[0].items[0].targetValue, 1000000);
  assert.equal(plan.items.국내주식[0].percent, 30);
});

test('new percentages use the parent amount literally at every level', () => {
  const plan = makePlan([{ id: 'a', name: 'A', percent: 30 }], { percent: 50 }, { categories: [{ id: '해외주식', percent: 60 }] });
  const category = guideFor(plan)[0];
  assert.equal(category.targetValue, 600000);
  assert.equal(category.groups[0].targetValue, 300000);
  assert.equal(category.groups[0].items[0].targetValue, 90000);
  assert.equal(category.groups[0].items[0].overallPercent, 9);
  assert.equal(category.groups[0].itemTotalPercent, 30);
});

test('current percentage uses current total assets even when the target budget differs', () => {
  const plan = makePlan([], {}, { budget: '2000000' });
  const category = guideFor(plan, [{ category: '해외주식', currentKRW: 400000 }])[0];
  assert.equal(category.currentPercent, 40);
  assert.equal(category.targetValue, 2000000);
});

test('budget modes distinguish an unfinished custom budget from current asset funding', () => {
  assert.equal(getTargetBudgetKRW({ budget: '' }, 123), 123);
  assert.equal(getTargetBudgetKRW({ budget: '456' }, 123), 456);
  assert.equal(getTargetBudgetKRW({ budgetMode: 'current', budget: '456' }, 123), 123);
  for (const budget of ['', '0']) {
    const plan = makePlan([], {}, { budgetMode: 'custom', budget });
    assert.equal(getTargetBudgetKRW(plan, 123), 0);
    assert.equal(guideFor(plan)[0].targetValue, 0);
    assert.match(getTargetPlanIssues(guideFor(plan), 100, 0).join(' '), /총금액/);
  }
});

test('normalization allocates exactly 1000 tenths including three equal and zero-weight entries', () => {
  for (const weights of [[1, 1, 1], [0, 0, 0], [1, 1, 4, 4, 7, 7, 13], [0, 1000, 0]]) {
    const result = normalizeTargetPercents(weights.map((percent) => ({ percent })));
    assert.equal(result.reduce((sum, value) => sum + Math.round(value * 10), 0), 1000);
    result.forEach((value) => close(value * 10, Math.round(value * 10)));
  }
  assert.deepEqual(normalizeTargetPercents([{ percent: 0 }, { percent: 0 }, { percent: 0 }]), [33.4, 33.3, 33.3]);
  assert.deepEqual(normalizeTargetPercents([]), []);
});

const holdings = [
  { id: 'a', name: 'Apple', ticker: 'aapl', category: '해외주식', accountName: 'A', currentKRW: 200000, quantity: 2, nativeCurrentPrice: 100, currency: 'USD' },
  { id: 'b', name: '애플', ticker: 'AAPL', category: '해외주식', accountName: 'B', currentKRW: 300000, quantity: 3, nativeCurrentPrice: 100, currency: 'USD' },
  { id: 'c', name: '삼성전자', ticker: '005930', category: '국내주식', currentKRW: 500000, quantity: 10, nativeCurrentPrice: 50000, currency: 'KRW' },
];

test('holding options aggregate one security across accounts while keeping categories separate', () => {
  const options = getTargetHoldingOptions(holdings, '해외주식');
  assert.equal(options.length, 1);
  assert.equal(options[0].ticker, 'AAPL');
  assert.equal(options[0].currentKRW, 500000);
  assert.equal(options[0].quantity, 5);
  assert.deepEqual(options[0].assetIds, ['a', 'b']);
  assert.equal(holdings[0].quantity, 2);
});

test('starting from holdings creates direct groups and preserves annual and other settings', () => {
  const previous = { budget: '20', annualReturn: { 2026: 15 }, settings: { showAnnual: true }, groups: { 해외주식: [{ id: 'old' }] } };
  const original = structuredClone(previous);
  const result = buildTargetPortfolioFromHoldings(previous, holdings);
  assert.equal(result.setupStarted, true);
  assert.equal(result.budgetMode, 'current');
  assert.equal(result.budget, '');
  assert.deepEqual(result.annualReturn, previous.annualReturn);
  assert.deepEqual(result.settings, previous.settings);
  assert.deepEqual(result.categories.map((category) => category.percent), [50, 50]);
  assert.equal(result.groups.해외주식[0].isDefault, true);
  assert.equal(result.groups.해외주식[0].allocationMode, 'percent');
  assert.equal(result.groups.해외주식[0].items.length, 1);
  const guide = guideFor(result, holdings);
  assert.equal(guide[0].groups[0].items[0].gapValue, 0);
  assert.deepEqual(getTargetPlanIssues(guide, 100, 1000000), []);
  assert.deepEqual(previous, original);
});

test('missing or zero quote yields an unknown adjustment quantity rather than zero shares', () => {
  const plan = makePlan([{ id: 'a', name: 'Unknown', ticker: 'NEW', percent: 100 }]);
  for (const assets of [[], [{ name: 'Unknown', ticker: 'NEW', category: '해외주식', currentKRW: 100, nativeCurrentPrice: 0 }]]) {
    const item = guideFor(plan, assets)[0].groups[0].items[0];
    assert.equal(item.adjustmentQuantity, null);
    assert.equal(item.adjustmentSide, 'buy');
  }
});

test('native quotes on a newly added security are converted before calculating quantity', () => {
  const item = guideFor(makePlan([{ name: 'New', ticker: 'NEW', percent: 100, nativePrice: 20, currency: 'USD' }]))[0].groups[0].items[0];
  assert.equal(item.currentPriceKRW, 20000);
  assert.equal(item.adjustmentQuantity, 50);
});

test('explicit ticker wins over same-name holdings and matching adds all accounts', () => {
  const plan = makePlan([{ name: 'Apple', ticker: 'AAPL', percent: 100 }]);
  const item = guideFor(plan, [...holdings, { name: 'Apple', ticker: 'OTHER', category: '해외주식', currentKRW: 100000 }])[0].groups[0].items[0];
  assert.equal(item.currentValue, 500000);
  assert.equal(item.matchedQuantity, 5);
});

test('target matching recognizes domestic and Japanese exchange aliases without merging other listings', () => {
  assert.equal(areTargetStocksSame({ ticker: '7203' }, { ticker: '7203.T' }), true);
  assert.equal(areTargetStocksSame({ ticker: '005930' }, { ticker: '005930.KS' }), true);
  assert.equal(areTargetStocksSame({ ticker: 'ABC.L', name: 'ABC' }, { ticker: 'ABC', name: 'ABC' }), false);
  const assets = [{ category: '해외주식', ticker: '7203', currentKRW: 10000, nativeCurrentPrice: 1000, currency: 'JPY' }];
  const item = guideFor(makePlan([{ name: 'Toyota', ticker: '7203.T', percent: 100 }]), assets)[0].groups[0].items[0];
  assert.equal(item.isMatched, true);
  assert.equal(item.currentValue, 10000);
  assert.equal(item.currency, 'JPY');
  assert.equal(getTargetHoldingOptions([...assets, { ...assets[0], ticker: '7203.T' }], '해외주식').length, 1);
});

test('duplicate target securities warn and never count the current holding twice across groups', () => {
  const plan = makePlan([{ name: 'Apple', ticker: 'AAPL', percent: 100 }], { percent: 50 });
  plan.groups.해외주식.push({ id: 'g2', name: 'Other', allocationMode: 'percent', percent: 50, items: [{ name: 'Apple', ticker: 'aapl', percent: 100 }] });
  const guide = guideFor(plan, holdings);
  assert.equal(guide[0].groups.reduce((sum, group) => sum + group.currentValue, 0), 500000);
  assert.equal(guide[0].unassignedValue, 0);
  assert.match(getTargetPlanIssues(guide, 100, 1000000).join(' '), /중복/);
});

test('plan issues explain incomplete, excess and unnamed allocations without rejecting category-only plans', () => {
  const incomplete = guideFor(makePlan([{ name: '', ticker: '', percent: 30 }]));
  assert.match(getTargetPlanIssues(incomplete, 90, 1000000).join(' '), /10%를 더/);
  assert.match(getTargetPlanIssues(incomplete, 100, 1000000).join(' '), /70%를 더/);
  assert.match(getTargetPlanIssues(incomplete, 100, 1000000).join(' '), /이름이나 티커/);
  assert.match(getTargetPlanIssues(guideFor(makePlan([{ name: 'Named', percent: 110 }])), 110, 1000000).join(' '), /초과/);
  assert.match(getTargetPlanIssues(guideFor(makePlan([])), 100, 1000000).join(' '), /100%를 더/);
  const categoryOnly = guideFor({ categories: [{ id: '해외주식', percent: 100 }], groups: {} });
  assert.deepEqual(getTargetPlanIssues(categoryOnly, 100, 1000000), []);
});
