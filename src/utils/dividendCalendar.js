const CURRENCY_ORDER = ['KRW', 'USD', 'JPY'];

const getCurrencyOrder = (currency) => {
  const index = CURRENCY_ORDER.indexOf(currency);
  return index === -1 ? CURRENCY_ORDER.length : index;
};

export const summarizeDividendCalendarEvents = (events = []) => {
  const totalsByCurrency = new Map();
  let estimatedCount = 0;
  let confirmedCount = 0;

  events.forEach((event) => {
    const amount = Number(event?.netAmount);
    if (!Number.isFinite(amount)) return;

    const currency = String(event?.currency || 'KRW').toUpperCase();
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) || 0) + amount);

    if (event?.isEstimated) estimatedCount += 1;
    else confirmedCount += 1;
  });

  const totals = [...totalsByCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((left, right) => (
      getCurrencyOrder(left.currency) - getCurrencyOrder(right.currency)
      || left.currency.localeCompare(right.currency)
    ));

  return {
    eventCount: confirmedCount + estimatedCount,
    confirmedCount,
    estimatedCount,
    totals,
  };
};
