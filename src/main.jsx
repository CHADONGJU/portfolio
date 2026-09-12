// 앱 진입점. 에러 경계로 감싸고 인증 관문 뒤에서 App을 지연 로드한다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AuthGate from './components/AuthGate.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import LazyApp from './components/LazyApp.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate>
          <LazyApp />
        </AuthGate>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
