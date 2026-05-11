import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { useConnection } from './store/connection.js';
import './styles.css';

if (
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  document.body.classList.add('reduced-motion');
}

if (typeof window !== 'undefined') {
  // Dev-only test hook: exposes the Zustand store so Playwright can inject
  // synthetic state (e.g. setHoveredSession) without simulating PixiJS
  // pointer events. The hook is harmless in production but only the e2e
  // suite reads it. No semantic change to runtime behavior.
  (window as unknown as { __claudevisStore?: typeof useConnection }).__claudevisStore =
    useConnection;
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
createRoot(root).render(<App />);
