import { useEffect, useState } from 'react';
import { useConnection } from './store/connection.js';

export function PromptBar({ sessionId }: { sessionId: string | null }) {
  const send = useConnection((s) => s.send);
  const pendingPromptPrefix = useConnection((s) => s.pendingPromptPrefix);
  const setPendingPromptPrefix = useConnection((s) => s.setPendingPromptPrefix);
  const [text, setText] = useState('');

  // M3b.2 T8: SkillDrawer click writes "/<name> " into pendingPromptPrefix.
  // Consume it here by prepending to the prompt input, then clear the slice
  // so this effect doesn't fire repeatedly.
  useEffect(() => {
    if (pendingPromptPrefix.length > 0) {
      setText((current) => `${pendingPromptPrefix}${current}`);
      setPendingPromptPrefix('');
    }
  }, [pendingPromptPrefix, setPendingPromptPrefix]);

  const submit = () => {
    if (!sessionId || !text.trim()) return;
    send({ type: 'session.send', sessionId, content: text });
    setText('');
  };

  return (
    <>
      <div className="prompt-session-indicator">{sessionId ? `→ ${sessionId}` : 'No session'}</div>
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
