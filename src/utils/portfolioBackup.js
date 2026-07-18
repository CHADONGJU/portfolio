const BACKUP_KIND = 'my-portfolio-backup';
const BACKUP_VERSION = 1;
const ARRAY_FIELDS = [
  'assets',
  'trades',
  'memos',
  'tradeLedger',
  'autoDividends',
  'confirmedDividends',
  'dividendAssetRegistry',
];

export const createPortfolioBackup = (snapshot = {}) => ({
  kind: BACKUP_KIND,
  version: BACKUP_VERSION,
  exportedAt: new Date().toISOString(),
  data: snapshot,
});

export const parsePortfolioBackup = (text = '') => {
  const backup = JSON.parse(text);
  if (backup?.kind !== BACKUP_KIND || backup?.version !== BACKUP_VERSION) {
    throw new Error('지원하지 않는 포트폴리오 백업 파일입니다.');
  }
  if (!backup.data || typeof backup.data !== 'object') {
    throw new Error('백업 파일에 포트폴리오 데이터가 없습니다.');
  }

  ARRAY_FIELDS.forEach((field) => {
    if (backup.data[field] !== undefined && !Array.isArray(backup.data[field])) {
      throw new Error(`백업의 ${field} 항목 형식이 올바르지 않습니다.`);
    }
  });

  return backup;
};
