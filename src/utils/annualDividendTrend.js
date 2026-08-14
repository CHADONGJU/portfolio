import {
  getDividendExDate,
  getDividendOfficialPaymentDate,
  getDividendReportingDate,
} from './dividendDates.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDate = (dateKey = '') => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
};

const formatUtcDateKey = (date) => date.toISOString().slice(0, 10);

const addUtcDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const addUtcMonthsClamped = (date, months) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const targetFirstDay = new Date(Date.UTC(year, month, 1));
  const targetLastDay = new Date(Date.UTC(
    targetFirstDay.getUTCFullYear(),
    targetFirstDay.getUTCMonth() + 1,
    0,
  )).getUTCDate();

  targetFirstDay.setUTCDate(Math.min(day, targetLastDay));
  return targetFirstDay;
};

const getEstimatedIntervalMonths = (history = []) => {
  const dates = history
    .map((dividend) => toUtcDate(getDividendExDate(dividend)))
    .filter(Boolean)
    .sort((left, right) => right - left);
  if (dates.length < 2) return 3;

  const days = (dates[0] - dates[1]) / DAY_MS;
  if (days >= 20 && days <= 45) return 1;
  if (days >= 80 && days <= 110) return 3;
  if (days >= 150 && days <= 200) return 6;
  if (days >= 330) return 12;
  return 3;
};

const getEstimatedPaymentLagDays = (history = []) => {
  const knownLags = history
    .map((dividend) => {
      const exDate = toUtcDate(getDividendExDate(dividend));
      const paymentDate = toUtcDate(getDividendReportingDate(dividend));
      if (!exDate || !paymentDate) return null;
      const lag = Math.round((paymentDate - exDate) / DAY_MS);
      return lag >= 0 && lag <= 120 ? lag : null;
    })
    .filter((lag) => lag !== null);

  return knownLags[0] ?? 0;
};

const buildEstimatedEvents = ({ summary, asset, year, today }) => {
  const history = Array.isArray(summary.history) ? summary.history : [];
  const exDates = history
    .map((dividend) => toUtcDate(getDividendExDate(dividend)))
    .filter(Boolean)
    .sort((left, right) => right - left);
  const amount = Number(summary.expectedAmount) || 0;
  if (exDates.length === 0 || amount <= 0) return [];

  const intervalMonths = getEstimatedIntervalMonths(history);
  const paymentLagDays = getEstimatedPaymentLagDays(history);
  const todayDate = toUtcDate(today.toISOString().slice(0, 10));
  const targetEnd = new Date(Date.UTC(year, 11, 31));
  const safeEnd = addUtcMonthsClamped(todayDate, 24);
  let estimatedExDate = addUtcMonthsClamped(exDates[0], intervalMonths);

  while (estimatedExDate < todayDate && estimatedExDate <= safeEnd) {
    estimatedExDate = addUtcMonthsClamped(estimatedExDate, intervalMonths);
  }

  const events = [];
  while (estimatedExDate <= targetEnd && estimatedExDate <= safeEnd) {
    const estimatedPaymentDate = addUtcDays(estimatedExDate, paymentLagDays);
    if (estimatedPaymentDate.getUTCFullYear() === year) {
      const date = formatUtcDateKey(estimatedPaymentDate);
      events.push({
        id: `${summary.name}-estimated-${date}`,
        name: summary.name,
        ticker: summary.ticker || asset?.ticker || summary.name,
        date,
        fxDate: date,
        currency: String(summary.currency || asset?.currency || 'KRW').toUpperCase(),
        amount,
        isEstimated: true,
      });
    }
    estimatedExDate = addUtcMonthsClamped(estimatedExDate, intervalMonths);
  }

  return events;
};

export const buildAnnualDividendEvents = ({
  dividendSummary = [],
  assets = [],
  year,
  today = new Date(),
}) => dividendSummary.flatMap((summary) => {
  const history = Array.isArray(summary.history) ? summary.history : [];
  const asset = assets.find((candidate) => candidate.name === summary.name);
  const confirmedEvents = history.map((dividend) => {
    const date = getDividendReportingDate(dividend);
    if (!date || Number(date.slice(0, 4)) !== year) return null;

    const amount = Number(dividend.amount) || 0;
    if (amount <= 0) return null;

    return {
      id: `${dividend.id || summary.name}-annual-${date}`,
      name: summary.name,
      ticker: dividend.ticker || summary.ticker || asset?.ticker || summary.name,
      date,
      fxDate: getDividendOfficialPaymentDate(dividend) || date,
      currency: String(dividend.currency || summary.currency || asset?.currency || 'KRW').toUpperCase(),
      amount,
      fxRate: Number(dividend.fxRate) || 0,
      isEstimated: false,
    };
  }).filter(Boolean);

  const estimatedEvents = year >= today.getFullYear()
    ? buildEstimatedEvents({ summary, asset, year, today })
    : [];

  return [...confirmedEvents, ...estimatedEvents];
});

export const summarizeAnnualDividendTrend = ({
  events = [],
  resolveKrwRate = () => 1,
  topAssetLimit = 5,
}) => {
  const convertedEvents = events.map((event) => {
    const rate = Number(resolveKrwRate(event));
    const amount = Number(event.amount) || 0;
    return {
      ...event,
      krwRate: Number.isFinite(rate) && rate > 0 ? rate : 0,
      krwAmount: Number.isFinite(rate) && rate > 0 ? amount * rate : 0,
    };
  }).filter((event) => event.krwAmount > 0);

  const totalsByAsset = convertedEvents.reduce((totals, event) => {
    totals.set(event.name, (totals.get(event.name) || 0) + event.krwAmount);
    return totals;
  }, new Map());
  const topAssets = [...totalsByAsset.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, topAssetLimit)
    .map(([name, amount]) => ({ name, amount }));
  const topAssetNames = new Set(topAssets.map((asset) => asset.name));

  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    total: 0,
    confirmedTotal: 0,
    estimatedTotal: 0,
    segments: [],
    events: [],
  }));

  convertedEvents.forEach((event) => {
    const monthIndex = Number(event.date.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) return;
    const month = months[monthIndex];
    const segmentName = topAssetNames.has(event.name) ? event.name : '기타';
    const segmentKey = `${segmentName}::${event.isEstimated ? 'estimated' : 'confirmed'}`;
    let segment = month.segments.find((candidate) => candidate.key === segmentKey);
    if (!segment) {
      segment = {
        key: segmentKey,
        name: segmentName,
        amount: 0,
        isEstimated: event.isEstimated,
      };
      month.segments.push(segment);
    }
    segment.amount += event.krwAmount;
    month.total += event.krwAmount;
    if (event.isEstimated) month.estimatedTotal += event.krwAmount;
    else month.confirmedTotal += event.krwAmount;
    month.events.push(event);
  });

  const orderByAsset = new Map(topAssets.map((asset, index) => [asset.name, index]));
  months.forEach((month) => {
    month.segments.sort((left, right) => {
      const leftOrder = left.name === '기타' ? topAssets.length : orderByAsset.get(left.name);
      const rightOrder = right.name === '기타' ? topAssets.length : orderByAsset.get(right.name);
      return leftOrder - rightOrder || Number(left.isEstimated) - Number(right.isEstimated);
    });
    month.events.sort((left, right) => right.krwAmount - left.krwAmount || left.name.localeCompare(right.name));
  });

  const annualTotal = months.reduce((sum, month) => sum + month.total, 0);
  const confirmedTotal = months.reduce((sum, month) => sum + month.confirmedTotal, 0);
  const estimatedTotal = months.reduce((sum, month) => sum + month.estimatedTotal, 0);

  return {
    months,
    topAssets,
    hasOther: [...totalsByAsset.keys()].some((name) => !topAssetNames.has(name)),
    annualTotal,
    confirmedTotal,
    estimatedTotal,
    monthlyAverage: annualTotal / 12,
    maxMonthTotal: Math.max(...months.map((month) => month.total), 0),
    eventCount: convertedEvents.length,
  };
};
