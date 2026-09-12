// Firestore 오류 코드를 사용자가 읽을 수 있는 문장으로 바꾼다.
const CONNECTION_ERRORS = new Set(['unavailable', 'deadline-exceeded', 'network-request-failed']);

export const getPortfolioSyncError = (error) => {
  const code = typeof error?.code === 'string' ? error.code.split('/').at(-1) : '';

  if (code === 'unsafe-portfolio-shrink') {
    return { code, message: '기록 감소가 감지되어 저장을 보류했습니다. 기존 기록은 보존됩니다.', retryable: false };
  }
  if (code === 'local-persistence-failed' || error?.name === 'QuotaExceededError') {
    return {
      code: 'local-persistence-failed',
      message: '이 기기에 기록을 저장하지 못했습니다. 복구본을 내려받아 주세요.',
      retryable: false,
    };
  }
  if (['unauthenticated', 'user-token-expired', 'invalid-user-token'].includes(code)) {
    return { code, message: '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.', retryable: false };
  }
  if (code === 'permission-denied') {
    return { code, message: '계정 기록에 접근할 권한을 확인하지 못했습니다. 로그인 계정을 확인해 주세요.', retryable: false };
  }
  if (code === 'resource-exhausted') {
    return { code, message: '서버 사용 한도에 도달해 저장을 보류했습니다. 잠시 후 다시 시도해 주세요.', retryable: false };
  }
  if (CONNECTION_ERRORS.has(code)) {
    return { code, message: '서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.', retryable: true };
  }
  return {
    code: code || 'sync-failed',
    message: '기록을 처리하는 중 오류가 발생해 동기화를 보류했습니다.',
    retryable: code === 'internal' || code === 'aborted',
  };
};
