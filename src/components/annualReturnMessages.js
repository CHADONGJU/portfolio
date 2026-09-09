export const getAnnualReturnUnavailableMessage = (performance) => {
  const reason = performance?.basisUnavailableReason;
  if (reason === 'missing-exchange-rate' || reason === 'missing-dividend-exchange-rate') {
    return '원화로 환산할 환율이 없는 내역이 있습니다. 해당 통화의 환율을 확인하면 수익률을 계산할 수 있습니다.';
  }
  if (reason === 'missing-dividend-cost') {
    return '배당을 받은 종목의 매수원가를 확인할 수 없습니다. 배당 기준일 이전 매수 기록이 필요합니다.';
  }
  if (reason === 'missing-holding-cost') {
    return '보유 종목 중 매수원가를 확인할 수 없는 종목이 있습니다. 누락된 매수 기록을 확인해 주세요.';
  }
  if (reason === 'missing-capital-base') {
    return '이 해의 연초 보유원가와 매수 기록이 없습니다. 수령 배당 내역은 별도로 표시합니다.';
  }
  return '매수원가를 확인할 수 없는 거래가 있습니다. 해당 연도와 이전의 매수·매도 기록을 확인해 주세요.';
};
