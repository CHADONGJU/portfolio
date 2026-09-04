const CURRENCY_ORDER = ['KRW', 'USD', 'JPY'];

const getCurrencyOrder = (currency) => {
  const index = CURRENCY_ORDER.indexOf(currency);
  return index === -1 ? CURRENCY_ORDER.length : index;
};

/**
 * 미래 예상 배당은 현재 보유 종목에만 만든다.
 *
 * 과거 보유 종목은 실제 수령 내역을 보여주기 위해 dividendSummary에 남아 있을 수 있다.
 * 이때 자산이 없다고 과거 배당 기록의 수량을 대신 쓰면 이미 매도한 종목의 미래 배당이
 * 캘린더에 다시 생긴다.
 */
export const getDividendCalendarForecastQuantity = (summary = {}, asset = null) => {
  if (summary.isCurrentHolding !== true) return 0;
  const quantity = Number(asset?.quantity) || 0;
  return quantity > 0 ? quantity : 0;
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
