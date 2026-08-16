let storageErrorHandler = null;

// 앱에서 한 번만 등록해두면, 저장 실패를 사용자에게 알릴 수 있다.
export const setStorageErrorHandler = (handler) => {
  storageErrorHandler = typeof handler === 'function' ? handler : null;
};

export const loadJson = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // 저장소 자체를 쓸 수 없는 환경(시크릿 모드 등)에서는 무시한다.
    }
    return fallback;
  }
};

export const saveJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    // 용량 초과(QuotaExceededError)나 시크릿 모드에서 throw되면
    // effect 밖으로 전파되어 화면이 통째로 죽는다. 여기서 삼킨다.
    console.error(`localStorage 저장 실패 (${key}):`, error);
    if (storageErrorHandler) storageErrorHandler(key, error);
    return false;
  }
};

/**
 * 포트폴리오 데이터는 계정별로 분리해서 저장한다.
 * 키를 계정으로 나누지 않으면 같은 브라우저를 쓰는 다음 사람에게
 * 이전 사용자의 자산이 그대로 보이고, 그 데이터가 새 계정의 클라우드로 올라간다.
 */
export const getScopedStorageKey = (key, scope = '') => (
  scope ? `${key}::${scope}` : key
);

export const hasStoredKey = (key) => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

/**
 * 계정 분리 이전에 저장된 키를 현재 계정 영역으로 한 번만 옮긴다.
 * 이미 해당 계정의 값이 있으면 건드리지 않으므로 여러 번 호출해도 안전하다.
 * (StrictMode의 이중 렌더에서도 같은 결과가 나와야 한다.)
 */
export const claimLegacyStorageKeys = (keys = [], scope = '') => {
  if (!scope) return 0;

  let claimed = 0;
  keys.forEach((key) => {
    const scopedKey = getScopedStorageKey(key, scope);
    if (scopedKey === key) return;

    try {
      if (localStorage.getItem(scopedKey) !== null) return;
      const legacyValue = localStorage.getItem(key);
      if (legacyValue === null) return;

      localStorage.setItem(scopedKey, legacyValue);
      localStorage.removeItem(key);
      claimed += 1;
    } catch (error) {
      console.error(`localStorage 계정 분리 실패 (${key}):`, error);
    }
  });

  return claimed;
};

export const removeStoredKeys = (keys = []) => {
  keys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`localStorage 삭제 실패 (${key}):`, error);
    }
  });
};
