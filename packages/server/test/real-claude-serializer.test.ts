import { describe, expect, it } from 'bun:test';
import { serializeUserPromptForRealCli } from '../src/real-claude-serializer.js';

describe('serializeUserPromptForRealCli', () => {
  it('produces the stream-input shape claude expects', () => {
    expect(serializeUserPromptForRealCli('hello')).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    });
  });

  it('preserves multiline strings verbatim', () => {
    const text = 'line one\nline two';
    const out = serializeUserPromptForRealCli(text);
    expect(out).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    });
  });
});
