import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioSyncSession } from '../src/services/portfolioSyncSession.js';
import { mergePendingPortfolio } from '../src/utils/portfolioSyncJournal.js';
import { assertSafePortfolioWrite } from '../src/utils/portfolioWriteSafety.js';

const snapshot = (memos = [], extra = {}) => ({ memos, assets: [], tradeLedger: [], ...extra });
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const setup = (options = {}) => {
  let stored = options.journal || null;
  const applied = [];
  const session = createPortfolioSyncSession({
    initial: options.initial || snapshot(), journal: stored,
    persist: (journal) => { stored = clone(journal); return true; },
    load: async () => ({ exists: true, data: snapshot(), revision: 'r1' }),
    save: async () => ({ revision: 'r2' }), migrate: async () => {},
    onApply: (value) => applied.push(value), ...options,
  });
  return { session, applied, stored: () => stored };
};

test('offline edits survive reload and merge with new records from another device', async () => {
  const first = setup();
  await first.session.refresh();
  first.session.capture(snapshot([{ id: 'local', text: 'offline memo' }]));
  first.session.close();
  const second = setup({
    initial: first.stored().local, journal: first.stored(),
    load: async () => ({ exists: true, data: snapshot([{ id: 'remote', text: 'other device' }]), revision: 'r3' }),
  });
  await second.session.refresh();
  assert.deepEqual(second.session.getJournal().local.memos.map((row) => row.id).sort(), ['local', 'remote']);
  assert.equal(second.session.hasPending(), true);
  await second.session.flush();
  assert.equal(second.session.hasPending(), false);
});

test('save acknowledgement never clears an edit made while request is in flight', async () => {
  const request = deferred();
  const started = deferred();
  const app = setup({ save: () => { started.resolve(); return request.promise; } });
  await app.session.refresh();
  app.session.capture(snapshot([{ id: 'memo', text: 'first' }]));
  const saving = app.session.flush();
  await started.promise;
  app.session.capture(snapshot([{ id: 'memo', text: 'second' }]));
  request.resolve({ revision: 'r2' });
  await saving;
  assert.equal(app.stored().base.memos[0].text, 'first');
  assert.equal(app.stored().local.memos[0].text, 'second');
  assert.equal(app.session.hasPending(), true);
});

test('failed server save leaves the durable journal available to a new session', async () => {
  const app = setup({ save: async () => { throw new Error('offline'); } });
  await app.session.refresh();
  app.session.capture(snapshot([{ id: 'trade', text: 'keep' }]));
  await assert.rejects(app.session.flush(), /offline/);
  assert.equal(app.stored().local.memos[0].text, 'keep');
  assert.equal(app.session.hasPending(), true);
});

test('same record edits merge by field and keep both values of conflicts', () => {
  const base = snapshot([{ id: 'm', text: 'old', tag: 'old' }]);
  const local = snapshot([{ id: 'm', text: 'mine', tag: 'old' }]);
  const remote = snapshot([{ id: 'm', text: 'theirs', tag: 'remote-tag' }]);
  const merged = mergePendingPortfolio(base, local, remote);
  assert.deepEqual(merged.snapshot.memos, [{ id: 'm', text: 'mine', tag: 'remote-tag' }]);
  assert.equal(merged.conflicts[0].remote, 'theirs');
});

test('deletions stay deleted without removing unrelated remote additions', () => {
  const base = snapshot([{ id: 'deleted', text: 'old' }]);
  const local = snapshot();
  const remote = snapshot([{ id: 'deleted', text: 'old' }, { id: 'new', text: 'new' }]);
  assert.deepEqual(mergePendingPortfolio(base, local, remote).snapshot.memos, [{ id: 'new', text: 'new' }]);
});

test('first journal keeps unknown old local data as recovery without resurrecting remote deletions', async () => {
  const app = setup({ initial: snapshot([{ id: 'unknown', text: 'old local' }]) });
  await app.session.refresh();
  assert.deepEqual(app.session.getJournal().local.memos, []);
  assert.equal(app.stored().recoveries[0].snapshot.memos[0].text, 'old local');
});

test('edits before first server load survive a failed load and reload', async () => {
  const first = setup({ load: async () => { throw new Error('offline'); } });
  first.session.capture(snapshot([{ id: 'new', text: 'before load' }]));
  await assert.rejects(first.session.refresh());
  first.session.close();
  const next = setup({ initial: first.stored().local, journal: first.stored() });
  await next.session.refresh();
  assert.equal(next.session.getJournal().local.memos[0].text, 'before load');
});

test('closing a session cannot let its late acknowledgement overwrite a new session journal', async () => {
  const request = deferred();
  const started = deferred();
  const app = setup({ save: () => { started.resolve(); return request.promise; } });
  await app.session.refresh();
  app.session.capture(snapshot([{ id: 'm', text: 'pending' }]));
  const saving = app.session.flush();
  await started.promise;
  app.session.close();
  const before = app.stored();
  request.resolve({ revision: 'r2' });
  await saving;
  assert.deepEqual(app.stored(), before);
});

test('local storage failure stops cloud replacement and preserves memory for export', async () => {
  const app = setup({ initial: snapshot([{ id: 'm', text: 'local' }]), persist: () => false });
  await assert.rejects(app.session.refresh(), (error) => error.code === 'local-persistence-failed');
  assert.equal(app.applied.length, 0);
  assert.equal(app.session.getJournal().recoveries[0].snapshot.memos[0].text, 'local');
});

test('legacy records excluded from the editable view do not trigger a destructive-write guard on every save', async () => {
  const archivedTrades = Array.from({ length: 10 }, (_, id) => ({ id: `legacy-${id}`, sellDate: '2025-01-01' }));
  const remote = snapshot([], { portfolioName: 'Portfolio', trades: archivedTrades });
  const writes = [];
  const app = setup({
    initial: remote,
    // The app derives its editable trades from the canonical trade ledger.
    compact: (value) => ({ ...value, trades: (value.trades || []).filter((trade) => trade.ledgerId) }),
    load: async () => ({ exists: true, data: remote, revision: 'r1' }),
    save: async (next, previous) => {
      assertSafePortfolioWrite(previous, next);
      writes.push({ next, previous });
      return { revision: 'r2' };
    },
  });
  await app.session.refresh();
  assert.equal(app.session.hasPending(), false, 'loading and normalizing records is not a user edit');
  await app.session.flush();
  assert.equal(writes.length, 0);
  app.session.capture({ ...app.applied.at(-1), portfolioName: 'Renamed' });
  await app.session.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].next.portfolioName, 'Renamed');
  assert.deepEqual(writes[0].previous.trades, [], 'diff must not delete excluded server records');
  assert.deepEqual(remote.trades, archivedTrades);
  assert.equal(app.session.hasPending(), false);
});

test('reconnecting repairs a journal with a raw baseline while preserving unsent edits and recoveries', async () => {
  const remote = snapshot([], { portfolioName: 'Before', trades: Array.from({ length: 10 }, (_, id) => ({ id })) });
  const local = { ...remote, trades: [], portfolioName: 'Unsent name' };
  const recoveries = [{ reason: 'before-first-sync', snapshot: remote }];
  const statuses = [];
  const app = setup({
    initial: local,
    journal: { version: 1, base: remote, local, revision: 'r1', recoveries },
    compact: (value) => ({ ...value, trades: [] }),
    load: async () => ({ exists: true, data: remote, revision: 'r1' }),
    save: async (next, previous) => { assertSafePortfolioWrite(previous, next); return { revision: 'r2' }; },
    onStatus: (status) => statuses.push(status),
  });
  await app.session.refresh();
  assert.equal(app.session.getJournal().local.portfolioName, 'Unsent name');
  await app.session.flush();
  assert.equal(statuses.at(-1).phase, 'saved');
  assert.equal(statuses.at(-1).error, null);
  assert.deepEqual(app.stored().recoveries, recoveries);
});

test('a write guard failure remains a processing error while later edits are safely captured', async () => {
  const statuses = [];
  const app = setup({
    save: async () => { throw Object.assign(new Error('guard'), { code: 'unsafe-portfolio-shrink' }); },
    onStatus: (status) => statuses.push(status),
  });
  await app.session.refresh();
  app.session.capture(snapshot([{ id: 'memo', text: 'first' }]));
  await assert.rejects(app.session.flush());
  app.session.capture(snapshot([{ id: 'memo', text: 'second' }]));
  assert.equal(statuses.at(-1).phase, 'error');
  assert.equal(statuses.at(-1).error.code, 'unsafe-portfolio-shrink');
  assert.equal(statuses.at(-1).error.retryable, false);
  assert.equal(app.stored().local.memos[0].text, 'second');
});

test('failed initial journal acknowledgement does not mark the session ready for saves', async () => {
  let stores = 0;
  const app = setup({ persist: () => ++stores !== 2 });
  await assert.rejects(app.session.refresh(), (error) => error.code === 'local-persistence-failed');
  assert.equal(app.session.isLoaded(), false);
  await app.session.refresh();
  assert.equal(app.session.isLoaded(), true);
});
