export const formatMoney = (val, currency) => {
  if (val === undefined || val === null || Number.isNaN(Number(val))) return '0';

  if (currency === 'USD') {
    return `$${Number(val).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  return `₩${Math.round(Number(val)).toLocaleString()}`;
};

export const formatInputNumber = (value) => {
  if (value === undefined || value === null || value === '') return '';

  const numeric = String(value).replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!numeric) return '';

  const [integerPart, decimalPart] = numeric.split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};

export const sanitizeNumericInput = (value) =>
  value.replace(/,/g, '').replace(/[^\d.]/g, '');
