import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { APP_NAME } from './config.js'
import UpdateBanner from './components/UpdateBanner.jsx'

document.title = APP_NAME

// Service worker registration (gated to production builds — registering
// against Vite's dev server would have the service worker fight HMR for
// control of module requests) plus new-version detection now lives in
// UpdateBanner, mounted below alongside <App /> rather than gated behind
// auth/role, since an update can be found at any time — even on the login
// page.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <UpdateBanner />
            <App />
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
