import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found in index.html');

// Provider order matters: BrowserRouter -> AuthContext -> App (which supplies
// the ToastProvider that every page's useToast() reads from).
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);