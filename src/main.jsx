import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AuthGate from './components/AuthGate.jsx'
import LocalRecoveryExport from './components/LocalRecoveryExport.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'

const isReadOnlyLocalRecovery = new URLSearchParams(window.location.search).get('local-recovery') === 'read-only'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isReadOnlyLocalRecovery ? (
      <LocalRecoveryExport />
    ) : (
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    )}
  </StrictMode>,
)
