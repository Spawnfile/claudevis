import { useState } from 'react';
import { useConnection } from './store/connection.js';

export function PromptBar({ sessionId }: { sessionId: string | null }) {
  const send = useConnection((s) => s.send);
  const [text, setText] = useState('');

  const submit = () => {
    if (!sessionId || !text.trim()) return;
    send({ type: 'session.send', sessionId, content: text });
    setText('');
  };

  return (
    <>
      <div style={{ fontSize: 11, color: '#7a8699', whiteSpace: 'nowrap' }}>
        {sessionId ? `→ ${sessionId}` : 'No session'}
      </div>
      <input
        className="prompt"
        value={text}
        placeholder="Type a prompt..."
        disabled={!sessionId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button
        type="button"
        onClick={() => sessionId && send({ type: 'session.interrupt', sessionId })}
        disabled={!sessionId}
      >
        ⏹
      </button>
      <button type="button" className="primary" onClick={submit} disabled={!sessionId}>
        Send
      </button>
    </>
  );
}
