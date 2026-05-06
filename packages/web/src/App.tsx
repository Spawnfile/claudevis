import { useEffect, useState } from 'react';
import { Chat } from './Chat.js';
import { PromptBar } from './PromptBar.js';
import { RawEvents } from './RawEvents.js';
import { SessionList } from './SessionList.js';
import { useConnection } from './store/connection.js';

// Same-origin WebSocket: the page is served by Vite (or whatever bundler in
// prod) which proxies /v1 to the backend. Using the page's own host+port
// avoids WSL2 / container / tunnel scenarios where a second port is not
// forwarded automatically.
const WS_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/v1`
    : 'ws://127.0.0.1:7878/v1';

type View = 'chat' | 'raw';

export function App() {
  const connect = useConnection((s) => s.connect);
  const connected = useConnection((s) => s.connected);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<View>('chat');

  useEffect(() => {
    connect(WS_URL);
  }, [connect]);

  return (
    <div className="app">
      <div className="left">
        <div style={{ fontSize: 10, color: connected ? '#6dba3a' : '#d94a4a', marginBottom: 8 }}>
          {connected ? '● connected' : '● disconnected'}
        </div>
        <SessionList activeSessionId={active} onSelect={setActive} />
      </div>
      <div className="main">
        <div className="tab-bar">
          <button
            type="button"
            className={view === 'chat' ? 'active' : ''}
            onClick={() => setView('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={view === 'raw' ? 'active' : ''}
            onClick={() => setView('raw')}
            data-testid="tab-raw"
          >
            Raw Events
          </button>
        </div>
        {view === 'chat' ? <Chat sessionId={active} /> : <RawEvents sessionId={active} />}
      </div>
      <div className="bottom">
        <PromptBar sessionId={active} />
      </div>
    </div>
  );
}
