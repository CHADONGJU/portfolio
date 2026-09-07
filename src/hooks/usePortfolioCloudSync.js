import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  loadPortfolioState, migratePortfolioState, saveJoinedAt,
  savePortfolioStateDiff, subscribePortfolioState,
} from '../services/portfolioStore.js';
import { createPortfolioSyncSession } from '../services/portfolioSyncSession.js';
import { readPortfolioJournal, writePortfolioJournal } from '../utils/portfolioSyncJournal.js';
import { formatKoreanDate } from '../utils/dates.js';
import { getPortfolioSyncError } from '../utils/portfolioSyncErrors.js';

const RETRY_DELAYS = [3000, 10000, 30000];

export default function usePortfolioCloudSync({ database, user, snapshot, ready, compact, protect, onApply, onLog }) {
  const userId = user?.uid || '';
  const userEmail = user?.email || '';
  const creationTime = user?.metadata?.creationTime;
  const callbacks = useRef({ snapshot, onApply, onLog });
  const sessionRef = useRef(null);
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState({ userId: '', loaded: !userId || !database, failed: false, phase: 'loading', pending: false, recoveryCount: 0 });

  useLayoutEffect(() => {
    callbacks.current = { snapshot, onApply, onLog };
    if (!ready || sessionRef.current?.userId !== userId) return;
    try {
      sessionRef.current.session.capture(snapshot);
    } catch (error) {
      onLog(error.message, 'error');
    }
  }, [snapshot, onApply, onLog, ready, userId]);

  useEffect(() => {
    if (!ready || !userId || !database) return undefined;
    let disposed = false;
    let unsubscribe = () => {};
    let needsJoinedAt = false;
    const session = createPortfolioSyncSession({
      initial: compact(callbacks.current.snapshot),
      journal: readPortfolioJournal(userId),
      persist: (journal) => writePortfolioJournal(userId, journal),
      load: async () => {
        const result = await loadPortfolioState(database, userId);
        needsJoinedAt = !result.exists || !result.data?.joinedAt;
        if (result.exists && !result.data?.joinedAt) {
          // Account metadata remains stored, but does not need React state.
          const date = creationTime ? new Date(creationTime) : new Date();
          saveJoinedAt(database, userId, formatKoreanDate(date)).catch(() => {});
        }
        return result;
      },
      save: (next, previous) => savePortfolioStateDiff(database, userId, next, previous, userEmail),
      migrate: async (next) => {
        await migratePortfolioState(database, userId, next, userEmail);
        if (needsJoinedAt) await saveJoinedAt(database, userId, formatKoreanDate(creationTime ? new Date(creationTime) : new Date()));
      },
      compact,
      protect,
      onApply: (next) => { if (!disposed) callbacks.current.onApply(next); },
      onStatus: (status) => { if (!disposed) setState((previous) => ({ ...previous, ...status })); },
    });
    sessionRef.current = { userId, session };
    setState({ userId, loaded: false, failed: false, phase: 'loading', pending: session.hasPending(), recoveryCount: 0 });
    session.refresh().then(() => {
      if (disposed) return;
      setState((previous) => ({ ...previous, loaded: true, failed: false }));
      unsubscribe = subscribePortfolioState(database, userId, ({ exists, revision }) => {
        if (!exists || disposed) return;
        session.refresh(revision).catch(() => {
          if (!disposed) callbacks.current.onLog('다른 기기의 변경을 불러오지 못했습니다. 미전송 기록은 유지됩니다.', 'error');
        });
      }, (error) => {
        if (!disposed) callbacks.current.onLog(getPortfolioSyncError(error).message, 'error');
      });
    }).catch(() => {
      if (!disposed) setState((previous) => ({ ...previous, loaded: true, failed: true }));
    });
    return () => {
      disposed = true;
      session.close();
      unsubscribe();
      if (sessionRef.current?.session === session) sessionRef.current = null;
    };
  }, [database, userId, userEmail, creationTime, ready, retryToken, compact, protect]);

  useEffect(() => {
    const session = sessionRef.current?.session;
    if (!session || !state.loaded || state.failed || state.userId !== userId) return undefined;
    let disposed = false;
    let timer;
    const save = async (attempt = 0) => {
      try {
        await session.flush();
      } catch (error) {
        if (disposed) return;
        if (getPortfolioSyncError(error).retryable && attempt < RETRY_DELAYS.length) {
          timer = setTimeout(() => save(attempt + 1), RETRY_DELAYS[attempt]);
        }
      }
    };
    timer = setTimeout(save, 700);
    return () => { disposed = true; clearTimeout(timer); };
  }, [snapshot, state.loaded, state.failed, state.userId, userId, retryToken]);

  const retry = useCallback(() => {
    const session = sessionRef.current?.session;
    if (session?.isLoaded()) {
      session.refresh().then(() => session.flush()).catch(() => {});
    } else {
      setRetryToken((token) => token + 1);
    }
  }, []);
  useEffect(() => {
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retry]);

  const downloadRecovery = useCallback(() => {
    const journal = sessionRef.current?.session.getJournal() || readPortfolioJournal(userId);
    if (!journal) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(journal, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `portfolio-recovery-${formatKoreanDate()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [userId]);

  if (!userId || !database) return { loaded: true, failed: false, userId: '', phase: 'local', pending: false, recoveryCount: 0, retry, downloadRecovery };
  return { ...state, loaded: state.userId === userId && state.loaded, retry, downloadRecovery };
}
