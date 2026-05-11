import type { SkillEntry } from '@claudevis/shared';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { CompletionDropdown } from './CompletionDropdown.js';
import { filterCatalog } from './completion.js';
import { useConnection } from './store/connection.js';

const SLASH_RE = /^\s*\/[a-zA-Z0-9_:-]*$/;

export function PromptBar({ sessionId }: { sessionId: string | null }) {
  const send = useConnection((s) => s.send);
  const catalog = useConnection((s) => s.catalog);
  const pendingPromptPrefix = useConnection((s) => s.pendingPromptPrefix);
  const setPendingPromptPrefix = useConnection((s) => s.setPendingPromptPrefix);
  const [text, setText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [closedByEscape, setClosedByEscape] = useState(false);

  // M3b.2 T8: SkillDrawer click writes "/<name> " into pendingPromptPrefix.
  // Consume it here by prepending to the prompt input, then clear the slice
  // so this effect doesn't fire repeatedly.
  useEffect(() => {
    if (pendingPromptPrefix.length > 0) {
      setText((current) => `${pendingPromptPrefix}${current}`);
      setPendingPromptPrefix('');
    }
  }, [pendingPromptPrefix, setPendingPromptPrefix]);

  const matchesSlash = SLASH_RE.test(text);
  const filtered = matchesSlash ? filterCatalog(catalog, text) : [];
  const open = matchesSlash && !closedByEscape && filtered.length > 0;

  const submit = () => {
    if (!sessionId || !text.trim()) return;
    send({ type: 'session.send', sessionId, content: text });
    setText('');
  };

  const selectEntry = (entry: SkillEntry) => {
    setText(`/${entry.name} `);
    setSelectedIndex(0);
    setClosedByEscape(false);
  };

  const onChange = (next: string) => {
    setText(next);
    setSelectedIndex(0);
    if (closedByEscape) setClosedByEscape(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filtered.length);
          return;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
          return;
        case 'Enter':
        case 'Tab': {
          e.preventDefault();
          const entry = filtered[selectedIndex];
          if (entry) selectEntry(entry);
          return;
        }
        case 'Escape':
          e.preventDefault();
          setClosedByEscape(true);
          return;
      }
      return;
    }
    if (e.key === 'Enter') submit();
  };

  return (
    <>
      <div className="prompt-session-indicator">{sessionId ? `→ ${sessionId}` : 'No session'}</div>
      <div className="prompt-input-wrap">
        {open && (
          <CompletionDropdown
            entries={filtered}
            selectedIndex={selectedIndex}
            onHover={setSelectedIndex}
            onSelect={selectEntry}
          />
        )}
        <input
          className="prompt"
          value={text}
          placeholder="Type a prompt..."
          disabled={!sessionId}
          role="combobox"
          aria-expanded={open}
          aria-controls="completion-dropdown"
          aria-autocomplete="list"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
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
