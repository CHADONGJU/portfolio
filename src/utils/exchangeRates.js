// 화면 표시용 환율 조회.
// 시세 동기화가 받아 둔 환율 표(rates)를 먼저 보고, 아직 못 받았으면 기본값으로
// 떨어진다. 여기서 돌려주는 값은 "오늘 환율"이므로 평가금액에만 쓰고, 과거
// 거래의 원가·실현손익에는 기록에 각인된 fxRate를 써야 한다.
export const getCachedKrwRate = (currency, rates = {}, usdRate = 1350, yenRate = 9.5) => {
  if (currency === 'USD') return usdRate || rates.USD || 1350;
  if (currency === 'JPY') return yenRate || rates.JPY || 9.5;
  if (currency && currency !== 'KRW') return rates[currency] || 1;
  return 1;
};
