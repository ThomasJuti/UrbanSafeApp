import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('No existe #root en index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
