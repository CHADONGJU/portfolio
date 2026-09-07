import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Only this test server substitutes authentication and Firestore. Every page
// uses a fresh browser context and synthetic records; no real account is read.
const fixture = {
  portfolioName: '점검용 포트폴리오',
  assets: [{ id: 'fixture', name: '테스트 주식', ticker: 'TEST', category: '해외주식', currency: 'USD', originalCurrency: 'USD', quantity: 10, averagePrice: 100, currentPrice: 120, originalAveragePrice: 100, originalCurrentPrice: 120, buyDate: '2026-09-01' }],
  tradeLedger: [{ id: 'buy-fixture', assetId: 'fixture', name: '테스트 주식', ticker: 'TEST', category: '해외주식', currency: 'USD', side: 'buy', quantity: 10, price: 100, date: '2026-09-01', fxRate: 1300, createdAt: '2026-09-01T01:00:00Z' }],
  memos: [],
  // Real accounts can retain old trades that the editable ledger view excludes.
  trades: Array.from({ length: 10 }, (_, id) => ({ id: `legacy-${id}`, name: '과거 기록', sellDate: '2025-01-01', quantity: 1, sellPrice: 50 })),
  autoDividends: [], confirmedDividends: [], dividendAssetRegistry: [],
  capitalFlows: [{ id: 'archived-flow', amountKRW: 1300000, date: '2026-09-01' }],
  portfolioSnapshots: [{ id: 'archived-snapshot', date: '2026-09-01', valueKRW: 1300000 }],
};
const authModule = `
  import { useState } from 'react';
  import { AuthContext } from './authContext';
  export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState({ uid: 'fixture-user', email: 'fixture@example.test', metadata: { creationTime: '2026-09-01T00:00:00Z' } });
    return <AuthContext.Provider value={{ user, isAuthLoading: false, isFirebaseConfigured: false,
      signOutUser: async () => setUser(null), signInWithGoogle: async () => {} }}>{children}</AuthContext.Provider>;
  };
`;
const storeModule = `
  import { assertSafePortfolioWrite } from '../utils/portfolioWriteSafety.js';
  const read = () => JSON.parse(localStorage.getItem('review-server'));
  const offline = () => localStorage.getItem('review-offline') === '1';
  export const loadPortfolioState = async () => {
    if (offline()) throw Object.assign(new Error('offline fixture'), { code: 'unavailable' });
    return { exists: true, data: read(), revision: localStorage.getItem('review-revision') || '1' };
  };
  export const savePortfolioStateDiff = async (_db, _user, next, previous) => {
    assertSafePortfolioWrite(previous, next);
    await new Promise(resolve => setTimeout(resolve, 50));
    if (offline()) throw Object.assign(new Error('offline fixture'), { code: 'unavailable' });
    // Like Firestore diffs, leave rows outside the editable baseline untouched.
    const archived = read().trades.filter(row => !(previous?.trades || []).some(old => old.id === row.id));
    localStorage.setItem('review-server', JSON.stringify({ ...next, trades: [...archived, ...next.trades] }));
    const revision = String(Number(localStorage.getItem('review-revision') || 1) + 1);
    localStorage.setItem('review-revision', revision);
    return { changed: true, revision };
  };
  export const migratePortfolioState = async (_db, _user, next) => localStorage.setItem('review-server', JSON.stringify(next));
  export const subscribePortfolioState = () => () => {};
  export const saveJoinedAt = async () => {};
`;
const server = await createServer({
  configFile: './vite.config.js',
  server: { host: '127.0.0.1', port: 0 },
  define: { 'import.meta.env.VITE_AI_PROXY_URL': '""' },
  plugins: [{
    name: 'isolated-browser-fixtures', enforce: 'pre',
    load(id) {
      const file = id.replaceAll('\\', '/');
      if (file.endsWith('/src/context/AuthProvider.jsx')) return authModule;
      if (file.endsWith('/src/firebase.js')) return 'export const db = {}; export const auth = null; export const isFirebaseConfigured = false;';
      if (file.endsWith('/src/services/portfolioStore.js')) return storeModule;
    },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1365, height: 980 } });
const errors = [];
try {
  await context.addInitScript((data) => {
    if (localStorage.getItem('review-server')) return;
    localStorage.setItem('review-server', JSON.stringify(data));
    localStorage.setItem('portfolio_assets_v17::fixture-user', JSON.stringify(data.assets));
    localStorage.setItem('portfolio_trade_ledger_v1::fixture-user', JSON.stringify(data.tradeLedger));
    localStorage.setItem('portfolio_capital_flows_v1::fixture-user', JSON.stringify(data.capitalFlows));
    localStorage.setItem('portfolio_value_snapshots_v1::fixture-user', JSON.stringify(data.portfolioSnapshots));
  }, fixture);
  await context.route('**/*', async (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    const url = route.request().url();
    if (url.includes('frankfurter') || url.includes('open.er-api')) return route.fulfill({ json: { rates: { KRW: 1400 }, time_last_update_unix: 1 } });
    if (url.includes('scanner.tradingview')) return route.fulfill({ json: { data: [] } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(45000);
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: '점검용 포트폴리오', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: /^저장 완료$/ }).waitFor();
  const verifyDialog = async (opener, name) => {
    await opener.click();
    const dialog = page.getByRole('dialog', { name });
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press(index % 3 === 0 ? 'Shift+Tab' : 'Tab');
      assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true);
  };
  await verifyDialog(page.getByRole('button', { name: '사용자 설정', exact: true }), '사용자 설정');
  await verifyDialog(page.getByTitle('AI 요약', { exact: true }), '테스트 주식 AI 요약');

  // A date edit starts a new lookup and saves its rate rather than the old 1300.
  await page.getByTitle('매수 기록 관리').click();
  const lookup = page.waitForResponse((response) => response.url().includes('frankfurter'));
  await page.getByLabel('1번째 매수 기록의 매수일').fill('2026-09-02');
  await lookup;
  await page.getByRole('button', { name: '매수 기록 저장하기' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('portfolio_trade_ledger_v1::fixture-user')).some((row) => row.date === '2026-09-02' && row.fxRate === 1400));

  // Offline edits survive a reload and are delivered after reconnecting.
  await page.evaluate(() => localStorage.setItem('review-offline', '1'));
  await page.getByRole('button', { name: '포트폴리오 이름 편집' }).click();
  const nameInput = page.getByRole('textbox', { name: '포트폴리오 이름' });
  await nameInput.fill('오프라인 수정 보존');
  await nameInput.press('Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('portfolio_sync_journal_v1::fixture-user')).local.portfolioName === '오프라인 수정 보존');
  await page.reload();
  await page.getByRole('heading', { name: '오프라인 수정 보존', exact: true }).waitFor();
  await page.evaluate(() => localStorage.removeItem('review-offline'));
  await page.getByRole('button', { name: '다시 연결', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('review-server')).portfolioName === '오프라인 수정 보존');
  await page.getByRole('status').filter({ hasText: /^저장 완료$/ }).waitFor();

  await page.getByRole('button', { name: '수익·배당', exact: true }).click();
  await page.getByRole('button', { name: '누락 매매 기록 추가', exact: true }).click();
  await page.getByRole('combobox', { name: '통화', exact: true }).selectOption('JPY');
  assert.equal(await page.getByRole('combobox', { name: '통화', exact: true }).inputValue(), 'JPY');
  await page.getByRole('button', { name: '내 포트폴리오', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await verifyDialog(page.getByRole('button', { name: '사용자 설정', exact: true }), '사용자 설정');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const preserved = await page.evaluate(() => JSON.parse(localStorage.getItem('review-server')));
  assert.deepEqual(preserved.capitalFlows, fixture.capitalFlows);
  assert.deepEqual(preserved.portfolioSnapshots, fixture.portfolioSnapshots);
  assert.deepEqual(preserved.trades, fixture.trades);
  assert.ok(await page.getByText('$120.00', { exact: true }).count() > 0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mobile-portfolio.png', fullPage: true });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('button', { name: '로그인 없이 둘러보기' }).click();
  assert.equal(await page.getByText('테스트 주식', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => Boolean(localStorage.getItem('portfolio_sync_journal_v1::fixture-user'))), true);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: desktop/mobile dialogs, FX date edit, offline reload/reconnect, JPY, archival data, account isolation.');
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
