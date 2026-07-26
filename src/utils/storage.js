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

export const removeStoredKeys = (keys = []) => {
  keys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`localStorage 삭제 실패 (${key}):`, error);
    }
  });
};
