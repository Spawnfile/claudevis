import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

if (
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  document.body.classList.add('reduced-motion');
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
createRoot(root).render(<App />);
