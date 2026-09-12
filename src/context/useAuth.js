// 인증 컨텍스트를 읽는 훅(현재 사용자, 로딩 여부, Firebase 설정 여부).
import { useContext } from 'react';
import { AuthContext } from './authContext';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
