import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStockSearchOptions,
  filterStockSearchOptions,
} from '../src/utils/stockSearchOptions.js';

test('builds one searchable option per stock name and combines its tickers', () => {
  const options = buildStockSearchOptions([
    { name: 'QUALCOMM', ticker: 'qcom' },
    { name: 'QUALCOMM', ticker: 'QCOM' },
    { name: 'KODEX 인도Nifty50', ticker: '453810' },
  ]);

  assert.deepEqual(options, [
    {
      value: 'KODEX 인도Nifty50',
      label: 'KODEX 인도Nifty50',
      description: '453810',
      keywords: ['453810'],
    },
    {
      value: 'QUALCOMM',
      label: 'QUALCOMM',
      description: 'QCOM',
      keywords: ['QCOM'],
    },
  ]);
});

test('ignores records without a stock name', () => {
  assert.deepEqual(buildStockSearchOptions([
    { name: '', ticker: 'EMPTY' },
    { ticker: 'MISSING' },
  ]), []);
});

test('searches the same stock options by ticker or Korean stock name', () => {
  const options = buildStockSearchOptions([
    { name: 'QUALCOMM', ticker: 'QCOM' },
    { name: 'KODEX 인도Nifty50', ticker: '453810' },
  ]);

  assert.deepEqual(filterStockSearchOptions(options, 'qcom').map((option) => option.value), ['QUALCOMM']);
  assert.deepEqual(filterStockSearchOptions(options, '인도').map((option) => option.value), ['KODEX 인도Nifty50']);
});
