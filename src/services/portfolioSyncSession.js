import { arePortfolioSnapshotsEquivalent } from '../utils/portfolioSnapshotComparison.js';
import {
  appendPortfolioRecovery, hasPendingPortfolio, mergePendingPortfolio,
} from '../utils/portfolioSyncJournal.js';

// One session belongs to exactly one account. Requests are serialized so an old
// save acknowledgement cannot clear a newer edit or race a remote reload.
export const createPortfolioSyncSession = ({
  initial, journal: savedJournal, persist, load, save, migrate,
  compact = (value) => value, protect = (remote) => remote,
  onApply = () => {}, onStatus = () => {},
}) => {
  let journal = savedJournal || { version: 1, base: null, local: initial, opening: initial, revision: '', recoveries: [] };
  const opening = compact(journal.opening || initial);
  let view = compact(initial);
  let loaded = false;
  let closed = false;
  let chain = Promise.resolve();
  let phase = 'loading';
  const pending = () => hasPendingPortfolio(journal);
  const report = () => {
    if (!closed) onStatus({ phase, pending: pending(), recoveryCount: journal.recoveries?.length || 0 });
  };
  const store = () => {
    if (!persist(journal)) {
      phase = 'local-error';
      report();
      const error = new Error('미전송 기록을 이 기기에 보관하지 못했습니다.');
      error.code = 'local-persistence-failed';
      throw error;
    }
  };
  const enqueue = (action) => {
    const request = chain.catch(() => {}).then(action);
    chain = request;
    return request;
  };
  const remember = (entry) => {
    journal = { ...journal, recoveries: appendPortfolioRecovery(journal.recoveries, entry) };
  };

  const refresh = (revision) => enqueue(async () => {
    if (closed || (loaded && revision && revision === journal.revision)) return;
    try {
      const remote = await load();
      if (closed) return;
      if (!remote.exists) {
        // Persist the complete initial portfolio before starting migration.
        store();
        const sent = compact(journal.local);
        await migrate(sent);
        if (closed) return;
        journal = { ...journal, base: sent, revision: '' };
      } else {
        const remoteSnapshot = compact(remote.data);
        const local = compact(journal.local);
        // The first version of the journal cannot distinguish old cached data
        // from unsent edits. Keep a recoverable copy and replay only edits made
        // since this session opened; never resurrect remotely deleted rows.
        if (!journal.base && !arePortfolioSnapshotsEquivalent(opening, remoteSnapshot)) {
          remember({ reason: 'before-first-sync', snapshot: opening });
        }
        const merged = mergePendingPortfolio(journal.base || opening, local, remoteSnapshot);
        if (merged.conflicts.length) remember({ reason: 'concurrent-edits', conflicts: merged.conflicts });
        const next = compact(protect(merged.snapshot, local));
        journal = { ...journal, base: remote.data, local: next, opening: undefined, revision: remote.revision || '' };
        store();
        if (remote.needsMigration) {
          await migrate(next);
          if (closed) return;
          // Edits captured during migration are still in journal.local.
          journal = { ...journal, base: next };
        }
        // Migration awaited network I/O, so apply the latest local snapshot.
        if (!closed) {
          view = journal.local;
          onApply(view);
        }
      }
      loaded = true;
      phase = pending() ? 'pending' : 'saved';
      store();
      report();
    } catch (error) {
      if (phase !== 'local-error') phase = 'error';
      report();
      throw error;
    }
  });

  return {
    refresh,
    capture(snapshot) {
      const next = compact(snapshot);
      if (arePortfolioSnapshotsEquivalent(journal.local, next)) { view = next; return; }
      const merged = mergePendingPortfolio(view, next, journal.local);
      view = next;
      journal = { ...journal, local: merged.snapshot };
      if (merged.conflicts.length) remember({ reason: 'edits-during-sync', conflicts: merged.conflicts });
      phase = pending() ? 'pending' : 'saved';
      store();
      report();
    },
    flush: () => enqueue(async () => {
      if (!loaded || closed || !pending()) return;
      store();
      const sent = compact(journal.local);
      phase = 'saving';
      report();
      try {
        const result = await save(sent, journal.base);
        if (closed) return;
        journal = { ...journal, base: sent, revision: result?.revision || journal.revision };
        phase = pending() ? 'pending' : 'saved';
        store();
        report();
      } catch (error) {
        if (phase !== 'local-error') phase = 'error';
        report();
        throw error;
      }
    }),
    getJournal: () => journal,
    hasPending: pending,
    isLoaded: () => loaded,
    close() { closed = true; },
  };
};
