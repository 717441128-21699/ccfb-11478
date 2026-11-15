import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './store';
import { AppShell } from './components/AppShell';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <AppShell />
    </AppProvider>
  </React.StrictMode>,
);
