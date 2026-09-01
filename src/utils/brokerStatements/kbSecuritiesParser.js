import { createSourceHash } from '../externalCashFlows.js';

const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;
const AMOUNT_PATTERN = /^-?[\d,]+(?:\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const groupLines = (items = [], tolerance = 3) => {
  const sorted = items
    .filter((item) => String(item?.text || '').trim())
    .map((item) => ({
      text: String(item.text).trim(),
      x: Number(item.x) || 0,
      top: Number(item.top) || 0,
    }))
    .sort((left, right) => left.top - right.top || left.x - right.x);
  const lines = [];

  sorted.forEach((item) => {
    const line = lines.findLast((candidate) => Math.abs(candidate.top - item.top) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ top: item.top, items: [item] });
  });

  return lines.map((line) => ({
    ...line,
    items: line.items.sort((left, right) => left.x - right.x),
    text: line.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(' '),
  }));
};

const readBand = (line, minX, maxX) => line?.items
  ?.filter((item) => item.x >= minX && item.x < maxX)
  .map((item) => item.text)
  .join(' ')
  .trim() || '';

const normalizeDate = (value) => String(value || '').replaceAll('/', '-');
const parseAmount = (value) => Number(String(value || '').replaceAll(',', ''));

const classifyKbTransaction = ({ rawType, companyStatus, bankStatus }) => {
  if (companyStatus !== '정상' || bankStatus !== '정상') return 'UNKNOWN';
  if (rawType === '외화연계입금') return 'DEPOSIT';
  return 'UNKNOWN';
};

const maskAccount = (accountNumber) => {
  const suffix = String(accountNumber || '').slice(-6);
  return suffix ? `***-***-${suffix}` : '';
};

export const isKbSecuritiesStatement = (pages = []) => pages
  .flatMap((page) => page.items || [])
  .map((item) => String(item?.text || '').trim())
  .filter(Boolean)
  .join(' ')
  .includes('외화 입출금 거래내역');

const parsePageRows = (lines, pageNumber) => {
  const rows = [];

  lines.forEach((line, lineIndex) => {
    const dateToken = line.items.find((item) => DATE_PATTERN.test(item.text));
    if (!dateToken || dateToken.x >= 90) return;

    const detailLine = lines[lineIndex + 1];
    const timeToken = detailLine?.items.find((item) => TIME_PATTERN.test(item.text));
    const amountToken = detailLine?.items.find((item) => (
      item.x >= 90 && item.x < 190 && AMOUNT_PATTERN.test(item.text)
    ));
    const currencyToken = detailLine?.items.find((item) => (
      item.x >= 290 && item.x < 390 && CURRENCY_PATTERN.test(item.text)
    ));
    if (!timeToken || !amountToken || !currencyToken) return;

    const rawType = readBand(line, 90, 190);
    const bankName = readBand(line, 190, 295);
    const recipientName = readBand(line, 295, 390);
    const descriptionText = readBand(line, 390, 495);
    const companyStatus = readBand(line, 495, Number.POSITIVE_INFINITY);
    const bankAccountNumber = readBand(detailLine, 190, 295);
    const mediumName = readBand(detailLine, 390, 495);
    const bankStatus = readBand(detailLine, 495, Number.POSITIVE_INFINITY);

    rows.push({
      pageNumber,
      transactionDate: normalizeDate(dateToken.text),
      transactionTime: timeToken.text,
      rawType,
      normalizedType: classifyKbTransaction({ rawType, companyStatus, bankStatus }),
      amount: Math.abs(parseAmount(amountToken.text)),
      currency: currencyToken.text,
      bankName,
      bankAccountNumber,
      recipientName,
      description: [bankName, recipientName, descriptionText].filter(Boolean).join(' / '),
      mediumName,
      companyStatus,
      bankStatus,
    });
  });

  return rows;
};

/** 실제 KB 외화 입출금 표의 좌표/문자열만 사용한다. */
export const parseKbSecuritiesStatement = async ({ pages = [], fileName = '' } = {}) => {
  const pageLines = pages.map((page) => groupLines(page.items));
  const allItems = pages.flatMap((page) => page.items || []);
  const allText = allItems.map((item) => String(item?.text || '').trim()).filter(Boolean);
  const titleFound = isKbSecuritiesStatement(pages);
  const accountNumber = allText
    .map((text) => text.match(/\b\d{3}-\d{3}-\d{3}-\d{2}\b/)?.[0] || '')
    .find(Boolean) || '';

  if (!titleFound) throw new Error('KB_FOREIGN_TRANSFER_STATEMENT_NOT_DETECTED');
  if (!accountNumber) throw new Error('KB_ACCOUNT_NUMBER_NOT_FOUND');

  const accountSeed = { broker: 'KB_SECURITIES', accountId: accountNumber };
  const accountHash = await createSourceHash(accountSeed);
  const transactions = pageLines.flatMap((lines, pageIndex) => parsePageRows(lines, pageIndex + 1));
  const normalizedTransactions = await Promise.all(transactions.map(async (transaction) => {
    const normalized = {
      ...transaction,
      broker: 'KB_SECURITIES',
      accountId: accountHash,
      accountDisplay: maskAccount(accountNumber),
      sourceFileName: fileName,
    };
    return { ...normalized, sourceHash: await createSourceHash(normalized) };
  }));

  return {
    broker: 'KB_SECURITIES',
    accountId: accountHash,
    accountDisplay: maskAccount(accountNumber),
    transactions: normalizedTransactions,
  };
};
