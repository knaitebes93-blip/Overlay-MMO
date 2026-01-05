import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import './style.css';

const rootElement = document.getElementById('root');
const appWindow = getCurrentWindow();

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App windowLabel={appWindow.label} />
    </React.StrictMode>,
  );
}
