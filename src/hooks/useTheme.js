import { useCallback, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '../constants.js';

const readStoredTheme = () => {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // 프라이빗 모드 등에서 storage 접근이 막혀도 앱은 계속 동작해야 한다.
  }
  return 'light';
};

/**
 * 라이트/다크 테마 상태.
 * html.dark 클래스 한 장으로 전환하고(토큰은 index.css에서 갈아끼운다),
 * 선택은 localStorage에 남겨 다음 방문에도 유지한다.
 * 첫 페인트 전 적용은 index.html의 인라인 스크립트가 담당한다.
 */
const useTheme = () => {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // 저장 실패는 치명적이지 않다.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
};

export default useTheme;
