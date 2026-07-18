const STORAGE_NAMESPACE = 'my-portfolio';

const getStorageKey = (key) => `${STORAGE_NAMESPACE}:${key}`;

export const loadJson = (key, fallback) => {
  const namespacedKey = getStorageKey(key);

  try {
    const saved = localStorage.getItem(namespacedKey) ?? localStorage.getItem(key);
    if (saved && localStorage.getItem(namespacedKey) === null) {
      localStorage.setItem(namespacedKey, saved);
    }
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    localStorage.removeItem(namespacedKey);
    return fallback;
  }
};

export const loadLegacyJson = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

export const saveJson = (key, value) => {
  localStorage.setItem(getStorageKey(key), JSON.stringify(value));
};
