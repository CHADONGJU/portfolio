import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_TYPE_GENERAL,
  ACCOUNT_TYPE_ISA,
  ACCOUNT_TYPE_PENSION,
  isDividendTaxDeferredAccount,
  migrateUserConfirmedAccountType,
  normalizeAccountType,
} from '../src/utils/accountTypes.js';

test('계좌 유형 표기를 내부 코드로 정규화한다', () => {
  assert.equal(normalizeAccountType('일반계좌'), ACCOUNT_TYPE_GENERAL);
  assert.equal(normalizeAccountType('isa'), ACCOUNT_TYPE_ISA);
  assert.equal(normalizeAccountType('연금저축'), ACCOUNT_TYPE_PENSION);
});

test('ISA와 연금계좌만 국내 배당의 즉시 원천징수를 유예한다', () => {
  assert.equal(isDividendTaxDeferredAccount(ACCOUNT_TYPE_GENERAL), false);
  assert.equal(isDividendTaxDeferredAccount(ACCOUNT_TYPE_ISA), true);
  assert.equal(isDividendTaxDeferredAccount(ACCOUNT_TYPE_PENSION), true);
});

test('사용자가 확인한 기존 인도 ETF 계좌 유형을 ISA로 한 번 이전한다', () => {
  const nifty = migrateUserConfirmedAccountType({ ticker: '453810.KS', accountType: 'GENERAL' });
  const tata = migrateUserConfirmedAccountType({ ticker: '477730', accountType: 'GENERAL' });

  assert.equal(nifty.accountType, ACCOUNT_TYPE_ISA);
  assert.equal(tata.accountType, ACCOUNT_TYPE_ISA);
  assert.equal(nifty.accountTypeSource, 'user-confirmed-2026-08-10');
});

test('화면에서 사용자가 바꾼 계좌 유형은 이전 규칙으로 덮지 않는다', () => {
  const asset = migrateUserConfirmedAccountType({
    ticker: '453810',
    accountType: 'GENERAL',
    accountTypeSource: 'user',
  });

  assert.equal(asset.accountType, ACCOUNT_TYPE_GENERAL);
  assert.equal(asset.accountTypeSource, 'user');
});
