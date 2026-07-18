const getAssetKey = (record = {}) => {
  const ticker = String(record.ticker || '').toUpperCase().trim();
  const name = String(record.name || record.stockName || '').trim();
  return ticker ? `ticker:${ticker}` : `name:${name}`;
};

const getStableRecordKey = (record = {}) => {
  if (record.id !== undefined && record.id !== null && String(record.id)) {
    return `id:${String(record.id)}`;
  }
  if (record.sourceId) return `source:${record.sourceId}`;
  return [
    getAssetKey(record),
    record.side || record.action || '',
    record.date || record.buyDate || record.sellDate || '',
    record.quantity || '',
    record.price || record.buyPrice || record.sellPrice || '',
  ].join('::');
};

const mergeMissingAssets = (current = [], recovered = [], preferRecovered = false) => {
  const rows = new Map();
  const first = preferRecovered ? current : recovered;
  const second = preferRecovered ? recovered : current;
  first.forEach((asset) => rows.set(getAssetKey(asset), asset));
  second.forEach((asset) => rows.set(getAssetKey(asset), asset));
  return [...rows.values()];
};

const mergeStableRecords = (current = [], recovered = [], preferRecovered = false) => {
  const first = preferRecovered ? current : recovered;
  const second = preferRecovered ? recovered : current;
  const rows = new Map(first.map((row) => [getStableRecordKey(row), row]));
  second.forEach((row) => rows.set(getStableRecordKey(row), row));
  return [...rows.values()];
};

const groupRecordsByAsset = (rows = []) => rows.reduce((groups, row) => {
  const key = getAssetKey(row);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
  return groups;
}, new Map());

const recoverRicherLedger = (current = [], recovered = [], preferRecovered = false) => {
  const currentGroups = groupRecordsByAsset(current);
  const recoveredGroups = groupRecordsByAsset(recovered);
  const assetKeys = new Set([...currentGroups.keys(), ...recoveredGroups.keys()]);

  return [...assetKeys].flatMap((assetKey) => {
    const currentRows = currentGroups.get(assetKey) || [];
    const recoveredRows = recoveredGroups.get(assetKey) || [];
    if (recoveredRows.length > currentRows.length) return recoveredRows;
    return mergeStableRecords(currentRows, recoveredRows, preferRecovered);
  });
};

const getSnapshotLatestTimestamp = (snapshot = {}) => [
  ...(snapshot.assets || []),
  ...(snapshot.trades || []),
  ...(snapshot.memos || []),
  ...(snapshot.tradeLedger || []),
].reduce((latest, row) => {
  const timestamp = Date.parse(row?.updatedAt || row?.createdAt || '');
  return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
}, 0);

export const recoverPortfolioSnapshot = (current = {}, recovered = {}) => {
  const currentAssets = Array.isArray(current.assets) ? current.assets : [];
  const recoveredAssets = Array.isArray(recovered.assets) ? recovered.assets : [];
  const currentLedger = Array.isArray(current.tradeLedger) ? current.tradeLedger : [];
  const recoveredLedger = Array.isArray(recovered.tradeLedger) ? recovered.tradeLedger : [];
  const hasRicherAssetBackup = recoveredAssets.length > currentAssets.length;
  const hasRicherLedgerBackup = recoveredLedger.length > currentLedger.length;
  const currentHasNoHoldings = currentAssets.length === 0 && currentLedger.length === 0;
  const recoveredIsNewer = getSnapshotLatestTimestamp(recovered) > getSnapshotLatestTimestamp(current);

  if (!hasRicherAssetBackup && !hasRicherLedgerBackup && !recoveredIsNewer) {
    return { recovered: false, snapshot: current, recoveredAssetCount: 0, recoveredLedgerCount: 0 };
  }

  const assets = mergeMissingAssets(currentAssets, recoveredAssets, recoveredIsNewer);
  const tradeLedger = recoverRicherLedger(currentLedger, recoveredLedger, recoveredIsNewer);
  const snapshot = {
    ...current,
    portfolioName: (currentHasNoHoldings || recoveredIsNewer) && recovered.portfolioName
      ? recovered.portfolioName
      : current.portfolioName,
    assets,
    tradeLedger,
    trades: mergeStableRecords(current.trades || [], recovered.trades || [], recoveredIsNewer),
    memos: mergeStableRecords(current.memos || [], recovered.memos || [], recoveredIsNewer),
    autoDividends: (recovered.autoDividends || []).length > (current.autoDividends || []).length
      || (recoveredIsNewer && (recovered.autoDividends || []).length === (current.autoDividends || []).length)
      ? (recovered.autoDividends || [])
      : (current.autoDividends || []),
    confirmedDividends: (recovered.confirmedDividends || []).length > (current.confirmedDividends || []).length
      || (recoveredIsNewer && (recovered.confirmedDividends || []).length === (current.confirmedDividends || []).length)
      ? (recovered.confirmedDividends || [])
      : (current.confirmedDividends || []),
    dividendAssetRegistry: (recovered.dividendAssetRegistry || []).length > (current.dividendAssetRegistry || []).length
      || (recoveredIsNewer && (recovered.dividendAssetRegistry || []).length === (current.dividendAssetRegistry || []).length)
      ? (recovered.dividendAssetRegistry || [])
      : (current.dividendAssetRegistry || []),
    targetPortfolio: (currentHasNoHoldings || recoveredIsNewer) && recovered.targetPortfolio
      ? recovered.targetPortfolio
      : current.targetPortfolio,
  };

  return {
    recovered: true,
    snapshot,
    recoveredAssetCount: Math.max(0, assets.length - currentAssets.length),
    recoveredLedgerCount: Math.max(0, tradeLedger.length - currentLedger.length),
  };
};
