// Step 3 interaction and responsive checks. Authentication and storage are
// replaced only in this Vite server, so no real account is read or changed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const domestic = [
  ['국내 장기투자용 초장문 반도체 및 미래산업 우량기업 혼합 포트폴리오', '010001', 20],
  ['국내 자동차', '010002', 20],
  ['국내 금융', '010003', 20],
  ['국내 배당 성장', '010004', 15],
  ['국내 통신', '010005', 15],
  ['국내 생활 소비재', '010006', 10],
];
const technology = [['테스트 테크 알파', 'TALPHA', 40], ['테스트 테크 베타', 'TBETA', 35], ['테스트 테크 감마', 'TGAMMA', 25]];
const dividend = [['테스트 배당 알파', 'DALPHA', 40], ['테스트 배당 베타', 'DBETA', 30], ['테스트 배당 감마', 'DGAMMA', 30]];
const makeItems = (rows, currency) => rows.map(([name, ticker, percent]) => ({ id: `target-${ticker}`, name, ticker, percent, currency, nativePrice: currency === 'KRW' ? 10000 : 100, price: '' }));
const assets = [...domestic, ...technology, ...dividend].map(([name, ticker], index) => {
  const currency = index < domestic.length ? 'KRW' : 'USD';
  const price = currency === 'KRW' ? 10000 : 100;
  return { id: `asset-${ticker}`, name, ticker, category: currency === 'KRW' ? '국내주식' : '해외주식', currency, originalCurrency: currency, quantity: 10, averagePrice: price, currentPrice: price, originalAveragePrice: price, originalCurrentPrice: price, buyDate: '2026-06-01' };
});
const fixture = {
  portfolioName: '종목 배분 점검', assets,
  tradeLedger: assets.map((asset) => ({ id: `buy-${asset.id}`, assetId: asset.id, name: asset.name, ticker: asset.ticker, category: asset.category, currency: asset.currency, side: 'buy', quantity: asset.quantity, price: asset.currentPrice, date: '2026-06-01', fxRate: asset.currency === 'KRW' ? 1 : 1400, createdAt: '2026-06-01T01:00:00Z' })),
  memos: [], trades: [], autoDividends: [], confirmedDividends: [], dividendAssetRegistry: [], capitalFlows: [], portfolioSnapshots: [],
  targetPortfolio: {
    budget: '50000000', budgetMode: 'custom', setupStarted: true,
    categories: [{ id: '국내주식', percent: 40 }, { id: '해외주식', percent: 60 }],
    items: { 국내주식: [], 해외주식: [] },
    groups: {
      국내주식: [{ id: 'domestic-direct', name: '직접 설정', isDefault: true, allocationMode: 'percent', percent: 100, items: makeItems(domestic, 'KRW') }],
      해외주식: [
        { id: 'technology', name: '빅테크', allocationMode: 'percent', percent: 60, items: makeItems(technology, 'USD') },
        { id: 'dividend', name: '배당주', allocationMode: 'percent', percent: 40, items: makeItems(dividend, 'USD') },
      ],
    },
  },
};
const authModule = `
  import { AuthContext } from './authContext';
  export const AuthProvider = ({ children }) => <AuthContext.Provider value={{
    user: { uid: 'fixture-user', email: 'fixture@example.test', metadata: { creationTime: '2026-09-01T00:00:00Z' } },
    isAuthLoading: false, isFirebaseConfigured: false, signOutUser: async () => {}, signInWithGoogle: async () => {},
  }}>{children}</AuthContext.Provider>;
`;
const storeModule = `
  import { assertSafePortfolioWrite } from '../utils/portfolioWriteSafety.js';
  export const loadPortfolioState = async () => ({ exists: true, data: JSON.parse(localStorage.getItem('review-server')), revision: localStorage.getItem('review-revision') || '1' });
  export const savePortfolioStateDiff = async (_db, _user, next, previous) => {
    assertSafePortfolioWrite(previous, next);
    await new Promise(resolve => setTimeout(resolve, 30));
    localStorage.setItem('review-server', JSON.stringify(next));
    const revision = String(Number(localStorage.getItem('review-revision') || 1) + 1);
    localStorage.setItem('review-revision', revision);
    return { changed: true, revision };
  };
  export const migratePortfolioState = async (_db, _user, next) => localStorage.setItem('review-server', JSON.stringify(next));
  export const subscribePortfolioState = () => () => {};
  export const saveJoinedAt = async () => {};
`;
const server = await createServer({
  configFile: './vite.config.js', server: { host: '127.0.0.1', port: 0 },
  define: { 'import.meta.env.VITE_AI_PROXY_URL': '""' },
  plugins: [{ name: 'isolated-target-allocation-fixtures', enforce: 'pre', load(id) {
    const file = id.replaceAll('\\', '/');
    if (file.endsWith('/src/context/AuthProvider.jsx')) return authModule;
    if (file.endsWith('/src/firebase.js')) return 'export const db = {}; export const auth = null; export const isFirebaseConfigured = false;';
    if (file.endsWith('/src/services/portfolioStore.js')) return storeModule;
  } }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
} catch (error) {
  if (process.env.BROWSER_CHANNEL || !/Executable doesn't exist/i.test(error.message)) {
    await server.close();
    throw error;
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
}
const errors = [];
const contexts = [];
const openFixture = async (data) => {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1365, height: 980 } });
  contexts.push(context);
  await context.addInitScript((initial) => {
    if (localStorage.getItem('review-server')) return;
    localStorage.setItem('review-server', JSON.stringify(initial));
    localStorage.setItem('portfolio_assets_v17::fixture-user', JSON.stringify(initial.assets));
    localStorage.setItem('portfolio_trade_ledger_v1::fixture-user', JSON.stringify(initial.tradeLedger));
  }, data);
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes('frankfurter') || url.includes('open.er-api')) return route.fulfill({ json: { rates: { KRW: 1400 }, time_last_update_unix: 1 } });
    if (url.includes('scanner.tradingview')) return route.fulfill({ json: { data: [] } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-18T03:00:00Z'));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: data.portfolioName, exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: /^저장 완료$/ }).waitFor();
  await page.getByRole('button', { name: '목표', exact: true }).click();
  return page;
};
const editAllocation = async (page) => {
  const allocation = page.getByRole('region', { name: '자산 배분 계획', exact: true });
  await allocation.getByRole('button', { name: '목표 수정', exact: true }).click();
  await allocation.getByRole('button', { name: '다음: 자산 비중', exact: true }).click();
  await allocation.getByRole('button', { name: '다음: 종목 배분', exact: true }).click();
  const editor = page.getByRole('region', { name: '종목 배분 편집', exact: true });
  await editor.waitFor();
  return { allocation, editor };
};
const noOverflow = async (page, label) => {
  const overflowing = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('main *')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((element) => ({ tag: element.tagName, label: element.getAttribute('aria-label'), text: element.textContent.slice(0, 60) })),
  }));
  assert.ok(overflowing.document <= overflowing.viewport + 1, `${label}: ${JSON.stringify(overflowing)}`);
};
const savedItem = async (page, ticker) => page.evaluate((key) => Object.values(JSON.parse(localStorage.getItem('review-server')).targetPortfolio.groups).flat().flatMap((group) => group.items).find((item) => item.ticker === key), ticker);

try {
  await mkdir('test-results', { recursive: true });
  const page = await openFixture(fixture);
  const { allocation, editor } = await editAllocation(page);
  const domesticButton = editor.getByRole('button', { name: '국내주식 종목 배분', exact: true });
  const overseasButton = editor.getByRole('button', { name: '해외주식 종목 배분', exact: true });
  assert.equal(await domesticButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await editor.getByLabel(`${domestic[0][0]} 목표 비중`, { exact: true }).inputValue(), '20');
  assert.equal(await editor.getByLabel('테스트 테크 알파 목표 비중', { exact: true }).count(), 0);
  await noOverflow(page, 'desktop direct allocation');
  await page.screenshot({ path: 'test-results/desktop-target-many-stocks.png', fullPage: true });

  // Several securities fit at once, including an unusually long Korean name.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page, `mobile ${width} direct allocation`);
    await page.screenshot({ path: `test-results/mobile-${width}-target-many-stocks.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1365, height: 980 });
  await overseasButton.click();
  assert.equal(await overseasButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await editor.getByRole('button', { name: '빅테크 종목 접기', exact: true }).count(), 1);
  assert.equal(await editor.getByRole('button', { name: '배당주 종목 펼치기', exact: true }).count(), 1);
  assert.equal(await editor.getByLabel('테스트 배당 알파 목표 비중', { exact: true }).count(), 0);
  assert.equal(await editor.getByRole('button', { name: '테스트 테크 알파에 남은 비중 채우기', exact: true }).count(), 0);

  const alpha = editor.getByLabel('테스트 테크 알파 목표 비중', { exact: true });
  const beta = editor.getByLabel('테스트 테크 베타 목표 비중', { exact: true });
  const gamma = editor.getByLabel('테스트 테크 감마 목표 비중', { exact: true });
  await alpha.fill('30');
  assert.equal(await overseasButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await allocation.getByRole('button', { name: '계획 확인', exact: true }).isDisabled(), true);
  await domesticButton.click();
  assert.equal(await allocation.getByRole('button', { name: '계획 확인', exact: true }).isDisabled(), true);
  await overseasButton.click();
  assert.equal(await alpha.inputValue(), '30');
  await editor.getByRole('button', { name: '입력한 비율대로 100% 맞추기', exact: true }).click();
  assert.ok(Math.abs(Number(await alpha.inputValue()) + Number(await beta.inputValue()) + Number(await gamma.inputValue()) - 100) < 0.0001);
  await allocation.getByRole('button', { name: '되돌리기', exact: true }).click();
  assert.equal(await alpha.inputValue(), '30');
  assert.equal(await beta.inputValue(), '35');
  assert.equal(await gamma.inputValue(), '25');
  await editor.getByRole('button', { name: '테스트 테크 알파에 남은 비중 채우기', exact: true }).click();
  assert.equal(await alpha.inputValue(), '40');
  assert.equal(await beta.inputValue(), '35');
  assert.equal(await gamma.inputValue(), '25');
  await allocation.getByRole('button', { name: '되돌리기', exact: true }).click();
  assert.equal(await alpha.inputValue(), '30');
  assert.equal(await beta.inputValue(), '35');
  assert.equal(await gamma.inputValue(), '25');
  await editor.getByRole('button', { name: '테스트 테크 알파에 남은 비중 채우기', exact: true }).click();
  await alpha.fill('90');
  assert.equal(await editor.getByRole('button', { name: '테스트 테크 알파에 남은 비중 채우기', exact: true }).count(), 0);
  await alpha.fill('40');

  // Switching categories and folding groups retain the exact input values.
  await domesticButton.click();
  assert.equal(await alpha.count(), 0);
  await overseasButton.click();
  assert.equal(await alpha.inputValue(), '40');
  await editor.getByRole('button', { name: '빅테크 종목 접기', exact: true }).click();
  assert.equal(await alpha.count(), 0);
  await editor.getByRole('button', { name: '빅테크 종목 펼치기', exact: true }).click();
  assert.equal(await alpha.inputValue(), '40');

  // Details are optional, but existing metadata remains editable in place.
  await editor.getByRole('button', { name: '테스트 테크 베타 종목 정보', exact: true }).click();
  await editor.getByLabel('테스트 테크 베타 티커 수정', { exact: true }).fill('EDITED');
  await editor.getByLabel('테스트 테크 베타 거래 통화', { exact: true }).selectOption('CAD');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('review-server')).targetPortfolio.groups.해외주식[0].items[1].currency === 'CAD');
  assert.equal((await savedItem(page, 'EDITED')).percent, 35);
  await editor.getByRole('button', { name: '테스트 테크 베타 종목 정보', exact: true }).click();

  await editor.getByRole('button', { name: '배당주 종목 펼치기', exact: true }).click();
  const dividendAlpha = editor.getByLabel('테스트 배당 알파 목표 비중', { exact: true });
  await dividendAlpha.fill('20');
  await editor.getByLabel('테스트 배당 베타 목표 비중', { exact: true }).fill('50');
  await editor.getByRole('button', { name: '배당주 종목 접기', exact: true }).click();
  await editor.getByRole('button', { name: '배당주 종목 펼치기', exact: true }).click();
  assert.equal(await dividendAlpha.inputValue(), '20');
  assert.equal(await allocation.getByRole('button', { name: '계획 확인', exact: true }).isEnabled(), true);
  await noOverflow(page, 'desktop grouped allocation');
  await page.screenshot({ path: 'test-results/desktop-target-grouped.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page, `mobile ${width} grouped allocation`);
    await page.screenshot({ path: `test-results/mobile-${width}-target-grouped.png`, fullPage: true });
  }

  await page.waitForFunction(() => JSON.parse(localStorage.getItem('review-server')).targetPortfolio.groups.해외주식[1].items[1].percent === '50');
  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('review-server')).targetPortfolio);
  await page.reload();
  await page.getByRole('button', { name: '목표', exact: true }).click();
  await editAllocation(page);
  await overseasButton.click();
  assert.equal(await alpha.inputValue(), '40');
  await editor.getByRole('button', { name: '배당주 종목 펼치기', exact: true }).click();
  assert.equal(await dividendAlpha.inputValue(), '20');
  assert.equal(await editor.getByLabel('테스트 배당 베타 목표 비중', { exact: true }).inputValue(), '50');
  await editor.getByRole('button', { name: '테스트 테크 베타 종목 정보', exact: true }).click();
  assert.equal(await editor.getByLabel('테스트 테크 베타 티커 수정', { exact: true }).inputValue(), 'EDITED');
  assert.equal(await editor.getByLabel('테스트 테크 베타 거래 통화', { exact: true }).inputValue(), 'CAD');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('review-server')).targetPortfolio), beforeReload);
  await noOverflow(page, 'mobile 320 metadata');

  // A remaining default group can still need its parent allocation corrected.
  const partialGroupFixture = structuredClone(fixture);
  partialGroupFixture.targetPortfolio.groups.국내주식[0].percent = 50;
  const partialGroupPage = await openFixture(partialGroupFixture);
  const partialGroup = await editAllocation(partialGroupPage);
  const parentPercent = partialGroup.editor.getByLabel('직접 설정 묶음 비중', { exact: true });
  assert.equal(await parentPercent.inputValue(), '50');
  assert.equal(await partialGroup.allocation.getByRole('button', { name: '계획 확인', exact: true }).isDisabled(), true);
  await parentPercent.fill('75');
  await partialGroupPage.waitForFunction(() => Number(JSON.parse(localStorage.getItem('review-server')).targetPortfolio.groups.국내주식[0].percent) === 75);
  await partialGroup.allocation.getByRole('button', { name: '이전', exact: true }).click();
  await partialGroup.allocation.getByRole('button', { name: '다음: 종목 배분', exact: true }).click();
  assert.equal(await parentPercent.inputValue(), '75');
  assert.equal(await partialGroup.editor.getByLabel(`${domestic[0][0]} 목표 비중`, { exact: true }).inputValue(), '20');
  await parentPercent.fill('100');
  assert.equal(await partialGroup.allocation.getByRole('button', { name: '계획 확인', exact: true }).isEnabled(), true);
  await partialGroupPage.waitForFunction(() => Number(JSON.parse(localStorage.getItem('review-server')).targetPortfolio.groups.국내주식[0].percent) === 100);

  // A category without securities remains a complete, useful allocation plan.
  const optionalFixture = structuredClone(fixture);
  optionalFixture.targetPortfolio.groups = { 국내주식: [], 해외주식: [] };
  const optionalPage = await openFixture(optionalFixture);
  const optional = await editAllocation(optionalPage);
  assert.equal(await optional.allocation.getByRole('button', { name: '계획 확인', exact: true }).isEnabled(), true);
  await optional.editor.getByRole('button', { name: '해외주식 종목 배분', exact: true }).click();
  assert.equal(await optional.allocation.getByRole('button', { name: '계획 확인', exact: true }).isEnabled(), true);
  await optional.editor.getByRole('button', { name: '종목을 묶어서 관리', exact: true }).click();
  assert.equal(await optional.editor.getByText('아직 담은 종목이 없어요', { exact: true }).isVisible(), true);
  assert.equal(await optional.editor.getByText('자산 비중만으로도 계획을 확인할 수 있습니다.', { exact: true }).isVisible(), true);
  assert.equal(await optional.editor.getByText('현재 목표에서 제외된 배분입니다', { exact: true }).count(), 0);
  assert.equal(await optional.editor.getByRole('progressbar', { name: '해외주식 묶음 배분 현황', exact: true }).count(), 0);
  assert.equal(await optional.editor.getByRole('button', { name: '종목 추가', exact: true }).count(), 0);
  assert.equal(await optional.editor.getByRole('button', { name: '종목 묶음 추가', exact: true }).isVisible(), true);
  assert.equal(await optional.allocation.getByRole('button', { name: '계획 확인', exact: true }).isEnabled(), true);
  await optional.allocation.getByRole('button', { name: '계획 확인', exact: true }).click();
  await optional.allocation.getByRole('heading', { name: '설정한 목표', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Target allocation browser checks passed: category navigation, fill remaining/undo, grouping/collapse, partial default groups, metadata, persistence, optional securities/group management, and desktop/390px/320px layouts.');
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await server.close();
}
