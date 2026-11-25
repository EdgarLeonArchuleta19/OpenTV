import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useAppStore } from './store/useAppStore';
import './index.css';

// Theme before the first paint, so a light-theme start never flashes the dark palette.
document.documentElement.dataset.theme = useAppStore.getState().appearance.theme;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
