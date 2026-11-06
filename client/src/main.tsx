import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './customers.css';
import './status.css';
import './shell.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);