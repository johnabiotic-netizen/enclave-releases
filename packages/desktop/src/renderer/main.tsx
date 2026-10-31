import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts ship with the app; nothing is fetched.
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import { App } from './App';
import './styles.css';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
