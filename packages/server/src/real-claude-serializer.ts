export function serializeUserPromptForRealCli(content: string): unknown {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: content }] },
  };
}
