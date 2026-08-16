let storageErrorHandler = null;

// 앱에서 한 번만 등록해두면, 저장 실패를 사용자에게 알릴 수 있다.
export const setStorageErrorHandler = (handler) => {
  storageErrorHandler = typeof handler === 'function' ? handler : null;
};

/**
 * 저장된 값이 기대한 모양인지 확인한다.
 *
 * JSON.parse는 성공했지만 모양이 다른 값(예: 배열 자리에 null이나 객체)이
 * 그대로 상태로 들어가면, 첫 렌더에서 `.length`나 `.map`이 터지면서 화면이
 * 통째로 하얘진다. 그 값은 localStorage에 남아 있으므로 새로고침해도 똑같이
 * 하얘져서, 앱 안에서는 복구할 방법이 없다.
 */
export const matchesFallbackShape = (value, fallback) => {
  if (fallback === null || fallback === undefined) return value !== undefined;
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (typeof fallback === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === typeof fallback;
};

export const loadJson = (key, fallback) => {
  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    // 저장소 자체를 쓸 수 없는 환경(시크릿 모드 등)에서는 기본값으로 시작한다.
    return fallback;
  }

  if (saved === null || saved === '') return fallback;

  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    // 값을 지우면 사용자 데이터가 조용히 사라진다. 남겨두고 기본값으로 시작한 뒤,
    // 사용자에게는 알린다.
    console.error(`localStorage 값을 읽을 수 없습니다 (${key}):`, error);
    if (storageErrorHandler) storageErrorHandler(key, error, 'read');
    return fallback;
  }

  if (!matchesFallbackShape(parsed, fallback)) {
    const error = new Error(`localStorage 값의 형식이 예상과 다릅니다 (${key})`);
    console.error(error);
    if (storageErrorHandler) storageErrorHandler(key, error, 'read');
    return fallback;
  }

  return parsed;
};

export const saveJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    // 용량 초과(QuotaExceededError)나 시크릿 모드에서 throw되면
    // effect 밖으로 전파되어 화면이 통째로 죽는다. 여기서 삼킨다.
    console.error(`localStorage 저장 실패 (${key}):`, error);
    if (storageErrorHandler) storageErrorHandler(key, error, 'write');
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
