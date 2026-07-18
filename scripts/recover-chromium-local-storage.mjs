import fs from 'node:fs';

const [filePath, originFilter = '', keyFilter = '', outputMode = 'raw', outputPath = ''] = process.argv.slice(2);
if (!filePath) throw new Error('Usage: node recover-chromium-local-storage.mjs <sst-file> [origin] [key]');

const file = fs.readFileSync(filePath);

const readVarint = (buffer, start) => {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < buffer.length && shift <= 63) {
    const byte = buffer[offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  throw new Error(`Invalid varint at ${start}`);
};

const decodeSnappy = (input) => {
  const header = readVarint(input, 0);
  const output = Buffer.alloc(header.value);
  let inputOffset = header.offset;
  let outputOffset = 0;

  while (inputOffset < input.length && outputOffset < output.length) {
    const tag = input[inputOffset++];
    const type = tag & 3;
    if (type === 0) {
      let length = tag >>> 2;
      if (length < 60) {
        length += 1;
      } else {
        const byteCount = length - 59;
        length = 0;
        for (let index = 0; index < byteCount; index += 1) {
          length += input[inputOffset++] * (2 ** (8 * index));
        }
        length += 1;
      }
      input.copy(output, outputOffset, inputOffset, inputOffset + length);
      inputOffset += length;
      outputOffset += length;
      continue;
    }

    let length;
    let copyOffset;
    if (type === 1) {
      length = 4 + ((tag >>> 2) & 7);
      copyOffset = ((tag & 0xe0) << 3) | input[inputOffset++];
    } else if (type === 2) {
      length = 1 + (tag >>> 2);
      copyOffset = input.readUInt16LE(inputOffset);
      inputOffset += 2;
    } else {
      length = 1 + (tag >>> 2);
      copyOffset = input.readUInt32LE(inputOffset);
      inputOffset += 4;
    }

    for (let index = 0; index < length; index += 1) {
      output[outputOffset] = output[outputOffset - copyOffset];
      outputOffset += 1;
    }
  }

  return output;
};

const readBlock = (offset, size) => {
  const raw = file.subarray(offset, offset + size);
  const compressionType = file[offset + size];
  if (compressionType === 0) return raw;
  if (compressionType === 1) return decodeSnappy(raw);
  throw new Error(`Unsupported block compression ${compressionType}`);
};

const parseBlockEntries = (block) => {
  if (block.length < 4) return [];
  const restartCount = block.readUInt32LE(block.length - 4);
  const entriesEnd = block.length - 4 - (restartCount * 4);
  const entries = [];
  let previousKey = Buffer.alloc(0);
  let offset = 0;

  while (offset < entriesEnd) {
    const shared = readVarint(block, offset);
    const unshared = readVarint(block, shared.offset);
    const valueLength = readVarint(block, unshared.offset);
    const keyStart = valueLength.offset;
    const keyEnd = keyStart + unshared.value;
    const valueEnd = keyEnd + valueLength.value;
    if (valueEnd > entriesEnd || shared.value > previousKey.length) break;
    const key = Buffer.concat([previousKey.subarray(0, shared.value), block.subarray(keyStart, keyEnd)]);
    const value = block.subarray(keyEnd, valueEnd);
    entries.push({ key, value });
    previousKey = key;
    offset = valueEnd;
  }
  return entries;
};

const decodeBlockHandle = (value) => {
  const offset = readVarint(value, 0);
  const size = readVarint(value, offset.offset);
  return { offset: offset.value, size: size.value };
};

const parseWriteBatch = (batch) => {
  if (batch.length < 12) return [];

  const expectedCount = batch.readUInt32LE(8);
  const entries = [];
  let offset = 12;

  for (let index = 0; index < expectedCount && offset < batch.length; index += 1) {
    const tag = batch[offset++];
    const keyLength = readVarint(batch, offset);
    offset = keyLength.offset;
    const keyEnd = offset + keyLength.value;
    if (keyEnd > batch.length) break;
    const key = batch.subarray(offset, keyEnd);
    offset = keyEnd;

    if (tag === 0) {
      entries.push({ key, value: Buffer.alloc(0), deleted: true });
      continue;
    }
    if (tag !== 1) break;

    const valueLength = readVarint(batch, offset);
    offset = valueLength.offset;
    const valueEnd = offset + valueLength.value;
    if (valueEnd > batch.length) break;
    entries.push({ key, value: batch.subarray(offset, valueEnd), deleted: false });
    offset = valueEnd;
  }

  return entries;
};

const parseLogEntries = () => {
  const blockSize = 32 * 1024;
  const logicalRecords = [];
  let fragments = [];

  for (let blockStart = 0; blockStart < file.length; blockStart += blockSize) {
    const blockEnd = Math.min(file.length, blockStart + blockSize);
    let offset = blockStart;

    while (offset + 7 <= blockEnd) {
      const length = file.readUInt16LE(offset + 4);
      const type = file[offset + 6];
      offset += 7;

      if (length === 0 && type === 0) break;
      if (offset + length > blockEnd) break;
      const payload = file.subarray(offset, offset + length);
      offset += length;

      if (type === 1) {
        logicalRecords.push(payload);
        fragments = [];
      } else if (type === 2) {
        fragments = [payload];
      } else if (type === 3 && fragments.length > 0) {
        fragments.push(payload);
      } else if (type === 4 && fragments.length > 0) {
        fragments.push(payload);
        logicalRecords.push(Buffer.concat(fragments));
        fragments = [];
      }
    }
  }

  return logicalRecords.flatMap(parseWriteBatch);
};

const decodeChromiumString = (value) => {
  if (value.length === 0) return '';
  const marker = value[0];
  if (marker === 0) return value.subarray(1).toString('utf16le');
  if (marker === 1) return value.subarray(1).toString('utf8');
  const sampleSize = Math.min(value.length, 200);
  let oddNullCount = 0;
  for (let index = 1; index < sampleSize; index += 2) {
    if (value[index] === 0) oddNullCount += 1;
  }
  if (oddNullCount > sampleSize / 8) return value.toString('utf16le');
  return value.toString('utf8');
};

const readTableEntries = () => {
  const footer = file.subarray(file.length - 48);
  decodeBlockHandle(footer);
  const indexHandleStart = readVarint(footer, 0).offset;
  const metaSizeEnd = readVarint(footer, indexHandleStart).offset;
  const indexHandle = decodeBlockHandle(footer.subarray(metaSizeEnd));
  const indexEntries = parseBlockEntries(readBlock(indexHandle.offset, indexHandle.size));

  return indexEntries.flatMap((indexEntry) => {
    const handle = decodeBlockHandle(indexEntry.value);
    return parseBlockEntries(readBlock(handle.offset, handle.size));
  });
};

const sourceEntries = filePath.toLowerCase().endsWith('.log')
  ? parseLogEntries()
  : readTableEntries();
const results = [];

for (const entry of sourceEntries) {
  const internalKey = filePath.toLowerCase().endsWith('.log')
    ? entry.key
    : entry.key.length >= 8 ? entry.key.subarray(0, -8) : entry.key;
  const keyText = internalKey.toString('utf8');
  if (originFilter && !keyText.includes(originFilter)) continue;
  if (keyFilter && !keyText.includes(keyFilter)) continue;
  results.push({
    key: keyText.replaceAll('\u0000', '<NUL>'),
    value: entry.deleted ? '' : decodeChromiumString(entry.value),
    deleted: Boolean(entry.deleted),
  });
}

if (outputMode === 'backup') {
  if (!outputPath) throw new Error('backup mode requires an output path');
  const storageValues = new Map();
  results.forEach((result) => {
    const logicalKey = result.key
      .slice(result.key.lastIndexOf('<NUL>') + '<NUL>'.length)
      .replace(/^[\u0000-\u001f]+/, '');
    if (!result.deleted && !storageValues.has(logicalKey)) {
      storageValues.set(logicalKey, JSON.parse(result.value));
    }
  });
  const readArray = (key) => {
    const value = storageValues.get(key);
    return Array.isArray(value) ? value : [];
  };
  const backup = {
    kind: 'my-portfolio-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    recoverySource: 'Chromium Local Storage LevelDB',
    data: {
      portfolioName: storageValues.get('portfolio_name_v1') || '투자 통합 대시보드',
      assets: readArray('portfolio_assets_v17'),
      trades: readArray('portfolio_trades_v17'),
      memos: readArray('portfolio_trade_memos_v1'),
      tradeLedger: readArray('portfolio_trade_ledger_v1'),
      autoDividends: readArray('portfolio_auto_dividends_v1'),
      confirmedDividends: readArray('portfolio_confirmed_dividends_v1'),
      dividendAssetRegistry: readArray('portfolio_dividend_asset_registry_v1'),
      targetPortfolio: storageValues.get('portfolio_target_plan_v1') || {},
    },
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    assets: backup.data.assets.length,
    trades: backup.data.trades.length,
    memos: backup.data.memos.length,
    tradeLedger: backup.data.tradeLedger.length,
  }));
} else if (outputMode === 'totals') {
  const summaries = results.map((result) => {
    try {
      const rows = JSON.parse(result.value);
      const totalsByCurrency = rows.reduce((totals, row) => {
        const currency = row.currency || 'KRW';
        totals[currency] = (totals[currency] || 0) + (Number(row.amount) || 0);
        return totals;
      }, {});
      const totalsByAsset = rows.reduce((totals, row) => {
        const name = row.name || row.ticker || 'unknown';
        if (!totals[name]) totals[name] = { count: 0, amount: 0, currency: row.currency || 'KRW' };
        totals[name].count += 1;
        totals[name].amount += Number(row.amount) || 0;
        return totals;
      }, {});
      return { key: result.key, rowCount: rows.length, totalsByCurrency, totalsByAsset };
    } catch (error) {
      return { key: result.key, parseError: error.message, valueLength: result.value.length };
    }
  });
  console.log(JSON.stringify(summaries, null, 2));
} else if (outputMode === 'summary') {
  const summaries = results.map((result) => {
    try {
      const rows = JSON.parse(result.value);
      if (!Array.isArray(rows)) return { key: result.key, valueType: typeof rows };
      return {
        key: result.key,
        rowCount: rows.length,
        names: [...new Set(rows.map((row) => row.name).filter(Boolean))],
        latestUpdatedAt: rows.map((row) => row.updatedAt || row.createdAt || '').sort().at(-1) || '',
        rows: rows.map((row) => ({
          name: row.name,
          ticker: row.ticker,
          side: row.side || row.action,
          date: row.date || row.buyDate || row.sellDate,
          quantity: row.quantity,
          price: row.price || row.averagePrice || row.buyPrice || row.sellPrice,
        })),
      };
    } catch (error) {
      return { key: result.key, parseError: error.message, valueLength: result.value.length };
    }
  });
  console.log(JSON.stringify(summaries, null, 2));
} else {
  console.log(JSON.stringify(results, null, 2));
}
