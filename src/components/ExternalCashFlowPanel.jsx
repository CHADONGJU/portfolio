import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Upload } from 'lucide-react';

import { getHistoricalFxRate } from '../services/historicalFx.js';
import { extractPdfStatementPages } from '../services/pdfStatement.js';
import { parseBrokerStatement } from '../utils/brokerStatements/index.js';
import {
  isExternalCashFlowType,
  resolveExternalCashFlowKrw,
  toCapitalFlowRecord,
} from '../utils/externalCashFlows.js';

const CLASSIFICATION_OPTIONS = [
  { value: 'DEPOSIT', label: '입금' },
  { value: 'WITHDRAWAL', label: '출금' },
  { value: 'INTERNAL', label: '내부거래' },
  { value: 'IGNORE', label: '무시' },
  { value: 'UNKNOWN', label: '확인 필요' },
];

const formatAmount = (amount, currency) => new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: currency || 'KRW',
  maximumFractionDigits: currency === 'KRW' ? 0 : 2,
}).format(Number(amount) || 0);

const formatDate = (date) => String(date || '').replaceAll('-', '.');

const errorMessage = (error) => {
  const code = String(error?.message || error || '');
  if (code.includes('PDF_FILE_TYPE_INVALID')) return 'PDF 파일만 선택할 수 있습니다.';
  if (code.includes('PDF_FILE_SIZE_INVALID')) return '10MB 이하의 정상 PDF를 선택해 주세요.';
  if (code.includes('BROKER_STATEMENT_NOT_SUPPORTED')) return '현재 지원하는 증권사 거래내역 형식을 확인하지 못했습니다.';
  if (code.includes('KB_FOREIGN_TRANSFER_STATEMENT_NOT_DETECTED')) return 'KB 외화 입출금 거래내역 형식을 확인하지 못했습니다.';
  if (code.includes('KB_ACCOUNT_NUMBER_NOT_FOUND')) return 'PDF에서 계좌번호를 확인하지 못했습니다.';
  return 'PDF 분석 중 오류가 발생했습니다. 원본 파일 형식을 확인해 주세요.';
};

const ExternalCashFlowPanel = ({ twrAvailableFrom, existingFlows = [], onApply }) => {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [accountDisplay, setAccountDisplay] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [applyResult, setApplyResult] = useState(null);

  const existingHashes = useMemo(() => new Set(existingFlows.map((flow) => (
    flow.sourceHash || flow.sourceIdentifier || flow.sourceId || flow.id
  )).filter(Boolean)), [existingFlows]);
  const storedPdfFlows = useMemo(() => existingFlows
    .filter((flow) => flow.sourceType === 'BROKER_PDF'), [existingFlows]);
  const latestUpdateDate = useMemo(() => storedPdfFlows
    .map((flow) => flow.date || '')
    .sort()
    .at(-1) || '', [storedPdfFlows]);
  const storedEligibleCount = storedPdfFlows.filter((flow) => (
    twrAvailableFrom && flow.date > twrAvailableFrom
  )).length;
  const storedExcludedCount = storedPdfFlows.length - storedEligibleCount;

  const summary = useMemo(() => transactions.reduce((result, transaction) => {
    result.total += 1;
    if (transaction.duplicate) result.duplicates += 1;
    if (transaction.normalizedType === 'DEPOSIT') result.deposits += 1;
    else if (transaction.normalizedType === 'WITHDRAWAL') result.withdrawals += 1;
    else if (transaction.normalizedType === 'UNKNOWN') result.unknown += 1;
    else result.internal += 1;
    return result;
  }, { total: 0, deposits: 0, withdrawals: 0, internal: 0, duplicates: 0, unknown: 0 }), [transactions]);

  const enrichTransaction = async (transaction, fxCache) => resolveExternalCashFlowKrw(
    transaction,
    (currency, baseCurrency, date) => {
      const key = `${currency}:${baseCurrency}:${date}`;
      if (!fxCache.has(key)) {
        fxCache.set(key, getHistoricalFxRate(currency, baseCurrency, date));
      }
      return fxCache.get(key);
    },
  );

  const handleFile = async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;

    setFileName(file.name);
    setTransactions([]);
    setAccountDisplay('');
    setBrokerName('');
    setStatus('parsing');
    setError('');
    setApplyResult(null);

    try {
      const pages = await extractPdfStatementPages(file);
      const parsed = await parseBrokerStatement({ pages, fileName: file.name });
      const fxCache = new Map();
      const enriched = await Promise.all(parsed.transactions.map(async (transaction) => ({
        ...await enrichTransaction(transaction, fxCache),
        duplicate: existingHashes.has(transaction.sourceHash),
        beforeTwrAvailableFrom: Boolean(
          !twrAvailableFrom || transaction.transactionDate <= twrAvailableFrom,
        ),
      })));
      setAccountDisplay(parsed.accountDisplay);
      setBrokerName(parsed.brokerName);
      setTransactions(enriched);
      setStatus('preview');
    } catch (nextError) {
      console.error('Broker PDF parse failed:', nextError);
      setError(errorMessage(nextError));
      setStatus('error');
    } finally {
      // 같은 파일을 다시 고를 수 있게 input 자체만 비운다. 원본 파일은 보관하지 않는다.
      event.target.value = '';
    }
  };

  const updateClassification = async (sourceHash, normalizedType) => {
    const current = transactions.find((transaction) => transaction.sourceHash === sourceHash);
    if (!current) return;

    const pending = { ...current, normalizedType, fxStatus: isExternalCashFlowType(normalizedType) ? 'LOADING' : 'NOT_REQUIRED' };
    setTransactions((previous) => previous.map((transaction) => (
      transaction.sourceHash === sourceHash ? pending : transaction
    )));

    const enriched = isExternalCashFlowType(normalizedType)
      ? await enrichTransaction(pending, new Map())
      : { ...pending, amountKRW: null, fxRate: null, fxRateDate: '', fxSource: '' };
    setTransactions((previous) => previous.map((transaction) => (
      transaction.sourceHash === sourceHash ? enriched : transaction
    )));
  };

  const unresolvedUnknownCount = transactions.filter((transaction) => (
    transaction.normalizedType === 'UNKNOWN' && !transaction.duplicate
  )).length;
  const importable = transactions.filter((transaction) => (
    isExternalCashFlowType(transaction.normalizedType) && !transaction.duplicate
  ));
  const eligibleImportableCount = importable.filter((transaction) => !transaction.beforeTwrAvailableFrom).length;
  const excludedImportableCount = importable.length - eligibleImportableCount;

  const applyTransactions = () => {
    const importedAt = new Date().toISOString();
    const records = importable.map((transaction) => toCapitalFlowRecord(transaction, importedAt)).filter(Boolean);
    if (records.length === 0) return;
    onApply(records);
    setApplyResult({
      savedCount: records.length,
      eligibleCount: eligibleImportableCount,
      excludedCount: excludedImportableCount,
    });
    setTransactions((previous) => previous.map((transaction) => (
      records.some((record) => record.sourceHash === transaction.sourceHash)
        ? { ...transaction, duplicate: true }
        : transaction
    )));
  };

  return (
    <section className="bg-surface rounded-[20px] overflow-hidden">
      <div className="p-5 md:p-7 border-b border-line flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-ink-soft" />
            <h3 className="text-base md:text-lg font-bold text-ink">입출금 내역 관리</h3>
          </div>
          <p className="mt-2 text-[12px] md:text-[13px] font-medium text-ink-mute">
            증권사는 PDF 내용으로 자동 감지합니다. 원본은 브라우저에서만 분석하고 구조화 내역만 저장합니다.
          </p>
          <p className="mt-1 text-[11px] font-semibold text-ink-mute">
            {latestUpdateDate ? `최근 업데이트 ${formatDate(latestUpdateDate)}` : '아직 반영된 PDF 내역이 없습니다.'}
          </p>
          {storedPdfFlows.length > 0 && (
            <p className="mt-1 text-[11px] font-semibold text-ink-mute">
              저장 {storedPdfFlows.length}건 · 기준일 다음 날 이후 TWR 대상 {storedEligibleCount}건
              {storedExcludedCount > 0 ? ` · 기준일 이전·당일 기록 보관 ${storedExcludedCount}건` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-col items-start md:items-end gap-2">
          <p className="text-[11px] font-bold text-ink-mute">현재 지원 형식 · KB증권 외화 입출금 거래내역</p>
          <div className="flex items-center gap-3">
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFile} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={status === 'parsing'}
            className="h-11 px-4 bg-ink text-surface rounded-xl text-[13px] font-bold inline-flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
          >
            <Upload size={16} /> {status === 'parsing' ? '분석 중' : applyResult ? '다음 PDF 업로드' : 'PDF 업로드'}
          </button>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="m-5 md:m-7 p-4 bg-danger-soft text-danger rounded-xl text-[13px] font-bold">{error}</p>}

      {transactions.length > 0 && (
        <div className="p-5 md:p-7 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <p className="text-[14px] font-bold text-ink">{fileName} 분석 완료</p>
              <p className="mt-1 text-[11px] font-semibold text-ink-mute">{brokerName} · 계좌 {accountDisplay} · 원본 PDF는 저장하지 않습니다.</p>
              <p className="mt-1 text-[11px] font-semibold text-ink-mute">한 파일씩 분석 결과를 확인하고 반영한 뒤 다음 PDF를 올려 주세요.</p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
              {[
                ['전체', summary.total],
                ['입금', summary.deposits],
                ['출금', summary.withdrawals],
                ['내부/무시', summary.internal],
                ['중복', summary.duplicates],
                ['확인 필요', summary.unknown],
              ].map(([label, value]) => (
                <div key={label} className="px-3 py-2 bg-canvas rounded-xl">
                  <p className="text-[10px] font-bold text-ink-mute">{label}</p>
                  <p className="mt-0.5 text-[14px] font-bold text-ink">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[900px] text-left">
              <thead className="bg-canvas text-[11px] font-bold text-ink-mute">
                <tr>
                  <th className="px-4 py-3">날짜/시간</th>
                  <th className="px-4 py-3">PDF 구분</th>
                  <th className="px-4 py-3">분류</th>
                  <th className="px-4 py-3 text-right">원금</th>
                  <th className="px-4 py-3 text-right">KRW 환산</th>
                  <th className="px-4 py-3">상세</th>
                  <th className="px-4 py-3">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((transaction) => (
                  <tr key={transaction.sourceHash} className="text-[12px] font-semibold text-ink-soft">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p>{formatDate(transaction.transactionDate)}</p>
                      <p className="text-ink-mute mt-0.5">{transaction.transactionTime}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{transaction.rawType || '-'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={transaction.normalizedType}
                        disabled={transaction.duplicate}
                        onChange={(event) => updateClassification(transaction.sourceHash, event.target.value)}
                        className="h-9 px-2.5 bg-canvas rounded-lg text-[12px] font-bold text-ink"
                      >
                        {CLASSIFICATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{formatAmount(transaction.amount, transaction.currency)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {transaction.amountKRW !== null
                        && transaction.amountKRW !== undefined
                        && Number.isFinite(Number(transaction.amountKRW))
                        ? formatAmount(transaction.amountKRW, 'KRW')
                        : '-'}
                      {transaction.fxRateDate && transaction.currency !== 'KRW' && (
                        <p className="mt-0.5 text-[10px] text-ink-mute">{transaction.fxRateDate} · {transaction.fxSource}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-56 truncate">{transaction.description || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {transaction.duplicate ? '중복' : transaction.fxStatus === 'FX_RATE_MISSING'
                        ? <span className="text-warn">환율 확인 필요</span>
                        : transaction.beforeTwrAvailableFrom
                          ? <span className="text-ink-mute">저장 대상 · 현재 TWR 구간 이전</span>
                          : transaction.normalizedType === 'UNKNOWN'
                            ? <span className="text-warn">분류 필요</span>
                            : '반영 대기'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-[12px] font-semibold">
              {unresolvedUnknownCount > 0 && (
                <p className="text-warn inline-flex items-center gap-1.5"><AlertTriangle size={14} /> 확인 필요 거래를 먼저 분류해 주세요.</p>
              )}
              {applyResult && (
                <p className="text-brand inline-flex items-center gap-1.5">
                  <CheckCircle2 size={14} />
                  {applyResult.savedCount}건 저장 · TWR 반영 {applyResult.eligibleCount}건
                  {applyResult.excludedCount > 0 ? ` · 현재 TWR 구간 이전 ${applyResult.excludedCount}건` : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={applyTransactions}
              disabled={unresolvedUnknownCount > 0 || importable.length === 0}
              className="h-11 px-5 bg-brand text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-40"
            >
              이 PDF 내역 반영 {importable.length > 0 ? `${importable.length}건` : ''}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default ExternalCashFlowPanel;
