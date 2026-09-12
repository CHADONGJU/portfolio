// Firebase 인증 상태를 구독해 앱 전체에 내려보낸다.
// Firebase가 설정되지 않은 환경(로컬 점검 등)에서도 앱이 뜨도록 처리한다.
import { useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../firebase';
import { AuthContext } from './authContext';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!auth) return undefined;

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
  }, []);

  const value = useMemo(() => ({
    user,
    isAuthLoading,
    isFirebaseConfigured,
    signInWithGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
    signOutUser: () => signOut(auth),
  }), [user, isAuthLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
