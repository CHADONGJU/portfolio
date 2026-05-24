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
