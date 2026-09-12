// 인증 컨텍스트 객체. Provider와 훅이 함께 참조한다.
import { createContext } from 'react';

export const AuthContext = createContext(null);
