import { getHistoricalFxRate } from '../../src/services/historicalFx.js';
import {
  commitPortfolioSnapshots,
  getPortfolioUserId,
  listPortfolioRoots,
  queryCollectionGroup,
} from './firestoreRest.js';
import { getServiceAccountAccessToken } from './googleOAuth.js';
import { calculatePortfolioValuation, collectValuationCurrencies } from './portfolioValuation.js';
import { fetchHistoricalCloseQuotes } from './historicalMarketData.js';
import { reconstructPortfolioAssetsAtDate } from './portfolioStateAtDate.js';
import { isFormalTwrSnapshot } from '../../src/utils/twrDatePolicy.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// OAuth 1 + Firestore read 5 + commit 1건을 제외하고도 Free Plan의
// 외부 subrequest 50건 한도에 여유를 남긴다. 예산이 다하면
// 임의 시세를 만들지 않고 해당 Snapshot을 INCOMPLETE로 저장한다.
const VALUATION_SUBREQUEST_BUDGET = 40;

export const getPreviousKstDate = (now = new Date()) => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
};

const shiftDate = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const getLatestScheduledSnapshotDate = (now = new Date()) => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstDate = kst.toISOString().slice(0, 10);
  const minutes = (kst.getUTCHours() * 60) + kst.getUTCMinutes();
  return shiftDate(kstDate, minutes >= (7 * 60) + 10 ? -1 : -2);
};

const isConfirmedFxRate = (entry, targetDate) => {
  const rateDate = String(entry?.rateDate || '');
  if (!(Number(entry?.rate) > 0) || !rateDate || rateDate > targetDate) return false;
  if (rateDate === targetDate) return true;
  const targetDay = new Date(`${targetDate}T00:00:00Z`).getUTCDay();
  return targetDay === 0 || targetDay === 6 || entry?.marketDayStatus === 'closed';
};

const groupDocumentsByUser = (documents) => documents.reduce((groups, document) => {
  const userId = getPortfolioUserId(document.name);
  if (!userId) return groups;
  if (!groups.has(userId)) groups.set(userId, []);
  groups.get(userId).push(document.data);
  return groups;
}, new Map());

const toValuationAsset = (asset = {}) => ({
  id: String(asset.id ?? asset.assetId ?? ''),
  ticker: asset.ticker || '',
  name: asset.name || '',
  category: asset.category || '',
  market: asset.market || '',
  currency: asset.currency || asset.originalCurrency || 'KRW',
  originalCurrency: asset.originalCurrency || asset.currency || 'KRW',
  quantity: asset.quantity ?? 0,
});

const selectRetryItems = ({ documents = [], rootsByUser, targetDate }) => {
  const oldestByUser = new Map();
  documents.forEach((document) => {
    const userId = getPortfolioUserId(document.name);
    const data = document.data || {};
    const date = String(data.date || '').slice(0, 10);
    const assets = Array.isArray(data.valuationAssets) ? data.valuationAssets : [];
    if (!userId || !rootsByUser.has(userId) || !date || date >= targetDate) return;
    if (data.source !== 'cloudflare-cron' || data.status !== 'incomplete' || assets.length === 0) return;
    const current = oldestByUser.get(userId);
    if (!current || date < current.date) {
      oldestByUser.set(userId, {
        userId,
        date,
        assets: assets.map(toValuationAsset),
        retry: true,
        portfolioStateIssues: Array.isArray(data.portfolioStateIssues)
          ? data.portfolioStateIssues
          : [],
        portfolioStateInputCounts: data.portfolioStateInputCounts || {},
      });
    }
  });
  // Free Plan subrequest 수를 제한하기 위해 사용자별 가장 오래된 실패일을 한 건씩 복구한다.
  return [...oldestByUser.values()];
};

export const runDailyPortfolioSnapshots = async (env, options = {}) => {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) throw new Error('firebase-project-id-missing');
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const targetDate = options.targetDate || getPreviousKstDate(now);
  const latestEligibleDate = getLatestScheduledSnapshotDate(now);
  if (targetDate > latestEligibleDate) {
    return {
      status: 'pending',
      reason: 'scheduled-finalization-cutoff-not-reached',
      targetDate,
      latestEligibleDate,
      userCount: 0,
      assetCount: 0,
      committed: 0,
      incompleteCount: 0,
    };
  }
  const accessToken = options.accessToken || await getServiceAccountAccessToken(env, { fetchImpl });

  const snapshotDocumentLoader = options.querySnapshotDocuments
    || (options.queryDocuments ? async () => [] : queryCollectionGroup);
  const tradeDocumentLoader = options.queryTradeDocuments
    || (options.queryDocuments ? async () => [] : queryCollectionGroup);
  const capitalFlowDocumentLoader = options.queryCapitalFlowDocuments
    || (options.queryDocuments ? async () => [] : queryCollectionGroup);
  const [
    roots,
    assetDocuments,
    tradeDocuments,
    capitalFlowDocuments,
    snapshotDocuments,
  ] = await Promise.all([
    (options.listRoots || listPortfolioRoots)({ projectId, accessToken, fetchImpl }),
    (options.queryDocuments || queryCollectionGroup)({
      projectId, accessToken, collectionId: 'assets', fetchImpl,
    }),
    tradeDocumentLoader({
      projectId, accessToken, collectionId: 'tradeLedger', fetchImpl,
    }),
    capitalFlowDocumentLoader({
      projectId, accessToken, collectionId: 'capitalFlows', fetchImpl,
    }),
    snapshotDocumentLoader({
      projectId,
      accessToken,
      collectionId: 'portfolioSnapshots',
      fetchImpl,
    }),
  ]);
  // Firestore의 collection-group 단일 필드 쿼리는 별도 COLLECTION_GROUP
  // 인덱스를 요구한다. Snapshot은 한 번만 읽고 메모리에서 나눠 사용하면
  // 인덱스 의존성과 REST 호출 한 건을 함께 줄일 수 있다.
  const incompleteSnapshotDocuments = snapshotDocuments.filter((document) => (
    document.data?.status === 'incomplete'
  ));
  const targetSnapshotDocuments = snapshotDocuments.filter((document) => (
    document.data?.date === targetDate
  ));
  const assetsByUser = groupDocumentsByUser(assetDocuments);
  const tradesByUser = groupDocumentsByUser(tradeDocuments);
  const capitalFlowsByUser = groupDocumentsByUser(capitalFlowDocuments);
  const rootsByUser = new Map(roots.map((root) => [getPortfolioUserId(root.name), root]));
  const eligibleRoots = roots.filter((root) => {
    // serviceJoinedAt 도입 전 DB는 joinedAt을 사용하므로 둘 다 읽는다.
    const serviceJoinedAt = String(root.data?.serviceJoinedAt || root.data?.joinedAt || '').slice(0, 10);
    return !serviceJoinedAt || serviceJoinedAt <= targetDate;
  });
  const lockedCompleteUsers = new Set(targetSnapshotDocuments.filter((document) => (
    document.data?.date === targetDate && isFormalTwrSnapshot(document.data)
  )).map((document) => getPortfolioUserId(document.name)));
  const currentItems = eligibleRoots.filter((root) => (
    !lockedCompleteUsers.has(getPortfolioUserId(root.name))
  )).map((root) => {
    const userId = getPortfolioUserId(root.name);
    const portfolioState = reconstructPortfolioAssetsAtDate({
      assets: assetsByUser.get(userId) || [],
      tradeLedger: tradesByUser.get(userId) || [],
      capitalFlows: capitalFlowsByUser.get(userId) || [],
      targetDate,
    });
    return {
      userId,
      date: targetDate,
      assets: portfolioState.assets,
      retry: false,
      portfolioStateIssues: portfolioState.issues,
      portfolioStateInputCounts: portfolioState.inputCounts,
    };
  });
  const retryItems = selectRetryItems({
    documents: incompleteSnapshotDocuments,
    rootsByUser,
    targetDate,
  });
  const workItems = [...retryItems, ...currentItems];
  const quoteLoader = options.quoteLoader || fetchHistoricalCloseQuotes;
  const fxResolver = options.fxResolver || getHistoricalFxRate;
  const requestBudget = options.requestBudget || { remaining: VALUATION_SUBREQUEST_BUDGET };
  const generatedAt = now.toISOString();
  const snapshotWrites = [];

  for (const date of [...new Set(workItems.map((item) => item.date))].sort()) {
    const dateItems = workItems.filter((item) => item.date === date);
    const flattenedAssets = dateItems.flatMap((item) => item.assets);
    const allQuotes = await quoteLoader(flattenedAssets, date, { fetchImpl, now, requestBudget });
    const currencies = collectValuationCurrencies(flattenedAssets, allQuotes);
    // Free Plan의 동시 외부 연결 제한(6개)을 넘지 않도록 환율은 통화별 순차 조회한다.
    const fxEntries = [];
    for (const currency of currencies) {
      const rawFx = await fxResolver(currency, 'KRW', date, { fetchImpl, requestBudget });
      fxEntries.push([currency, rawFx ? {
        ...rawFx,
        validationStatus: isConfirmedFxRate(rawFx, date) ? 'confirmed' : 'pending',
      } : null]);
    }
    const fxRates = new Map(fxEntries);
    let quoteOffset = 0;

    dateItems.forEach(({
      userId,
      assets,
      retry,
      portfolioStateIssues = [],
      portfolioStateInputCounts = {},
    }) => {
      const quotes = allQuotes.slice(quoteOffset, quoteOffset + assets.length);
      quoteOffset += assets.length;
      const valuation = calculatePortfolioValuation({ assets, quotes, fxRates, targetDate: date });
      const status = valuation.status === 'complete' && portfolioStateIssues.length === 0
        ? 'complete'
        : 'incomplete';
      snapshotWrites.push({
        userId,
        id: `snapshot-${date}`,
        data: {
          id: `snapshot-${date}`,
          date,
          valueKRW: valuation.valueKRW,
          unrealizedProfitKRW: null,
          includesCash: true,
          status,
          valuationValidation: status === 'complete' ? 'confirmed' : 'incomplete',
          source: 'cloudflare-cron',
          generatedAt,
          valuationBasis: 'eod',
          // 미국 D일 종가는 KST로 D+1 새벽에 확정된다. D일 23:59 KST를
          // 평가시각으로 꾸미지 않고, 모든 필수 종가/환율을 검증한 실제 시각을 남긴다.
          valuationTimestamp: generatedAt,
          valuationDate: date,
          retryOfIncomplete: retry,
          fxRates: Object.fromEntries(fxEntries.map(([currency, fx]) => [currency, fx || {
            currency,
            baseCurrency: 'KRW',
            requestedDate: date,
            rateDate: '',
            rate: null,
            source: '',
          }])),
          valuationAssets: assets.map(toValuationAsset),
          portfolioStateIssues,
          portfolioStateInputCounts,
          missingAssets: valuation.missingAssets,
          missingCurrencies: valuation.missingCurrencies,
          assetValues: valuation.assetValues,
          valuationIssues: [...portfolioStateIssues, ...valuation.valuationIssues],
          assetCount: assets.length,
        },
      });
    });
  }

  const committed = snapshotWrites.length > 0
    ? await (options.commitSnapshots || commitPortfolioSnapshots)({
      projectId, accessToken, snapshots: snapshotWrites, fetchImpl,
    })
    : 0;
  return {
    status: 'completed',
    targetDate,
    userCount: eligibleRoots.length,
    assetCount: currentItems.reduce((sum, item) => sum + item.assets.length, 0),
    retryCount: retryItems.length,
    committed,
    incompleteCount: snapshotWrites.filter((snapshot) => snapshot.data.status !== 'complete').length,
  };
};
