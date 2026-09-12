// 수령 배당의 원화 환산과 합계.
// 환율은 기록에 각인된 값 → 지급일의 과거 환율 → 오늘 환율(근사) 순으로 고른다.
// 근사를 쓴 경우 approximate로 표시해 화면이 감추지 않게 한다.
import { formatKoreanDate } from './dates.js';
import { getDividendOfficialPaymentDate, getDividendReportingDate } from './dividendDates.js';
import { isConfirmedDividendRecord, selectReceivedDividendRecords } from './dividendRecords.js';

const positiveRate = (value) => {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
};

const getCurrency = (record) => String(record.currency || 'KRW').trim().toUpperCase();
const getFxDate = (record) => (
  getDividendOfficialPaymentDate(record) || record.fxDate || getDividendReportingDate(record)
);

/**
 * Every dividend income view uses the same conversion: recorded payment rate,
 * then the historical payment-date rate, then a visibly approximate current rate.
 * Unknown currencies remain in their native total until a real rate is available.
 */
export const resolveDividendIncomeRate = (record = {}, {
  exchangeRate,
  jpyKrwRate,
  currencyRates = {},
  historicalRates = {},
} = {}) => {
  const currency = getCurrency(record);
  if (currency === 'KRW') return { rate: 1, approximate: false, unconverted: false };

  const storedRate = positiveRate(record.fxRate);
  if (storedRate) return { rate: storedRate, approximate: false, unconverted: false };

  // The existing historical cache contains USD/KRW rates keyed by payment date.
  // Never apply one of those rates to another foreign currency.
  const historicalRate = currency === 'USD' ? positiveRate(historicalRates[getFxDate(record)]) : 0;
  if (historicalRate) return { rate: historicalRate, approximate: false, unconverted: false };

  const rate = currency === 'USD'
    ? positiveRate(exchangeRate) || positiveRate(currencyRates.USD) || 1350
    : currency === 'JPY'
      ? positiveRate(jpyKrwRate) || positiveRate(currencyRates.JPY) || 9.5
      : positiveRate(currencyRates[currency]);
  return { rate, approximate: true, unconverted: rate === 0 };
};

/**
 * Shared received-income aggregation for returns and the dividend screen.
 * Callers pass the already reconciled formula/manual ledger: this function must
 * not merge same-day receipts belonging to separate accounts or payments.
 */
export const summarizeDividendIncome = ({
  dividends = [],
  year,
  today = new Date(),
  ...rates
} = {}) => {
  const todayKey = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today
    : formatKoreanDate(today);
  const numericYear = year === undefined || year === null ? null : Number(year);
  const events = selectReceivedDividendRecords(dividends, todayKey).flatMap((record) => {
    const date = getDividendReportingDate(record);
    const amount = Number(record.amount);
    if (!date || !Number.isFinite(amount) || amount <= 0) return [];
    if (numericYear !== null && Number(date.slice(0, 4)) !== numericYear) return [];

    const { rate, approximate, unconverted } = resolveDividendIncomeRate(record, rates);
    return [{
      ...record,
      currency: getCurrency(record),
      date,
      fxDate: getFxDate(record),
      amount,
      krwRate: rate,
      krwAmount: amount * rate,
      approximate,
      unconverted,
    }];
  });

  const amountsByCurrency = new Map();
  let totalKRW = 0;
  let manualCount = 0;
  let unconvertedCount = 0;
  events.forEach((event) => {
    amountsByCurrency.set(event.currency, (amountsByCurrency.get(event.currency) || 0) + event.amount);
    totalKRW += event.krwAmount;
    if (isConfirmedDividendRecord(event)) manualCount += 1;
    if (event.unconverted) unconvertedCount += 1;
  });

  return {
    events,
    totals: [...amountsByCurrency].map(([currency, amount]) => ({ currency, amount })),
    totalKRW,
    count: events.length,
    manualCount,
    automaticCount: events.length - manualCount,
    approximate: events.some((event) => event.approximate),
    unconvertedCount,
  };
};
