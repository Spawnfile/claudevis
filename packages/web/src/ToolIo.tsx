import { memo } from 'react';

interface ToolIoProps {
  content: string;
  threshold?: number;
}

const DEFAULT_THRESHOLD = 500;

/**
 * Renders a JSON string. Below the threshold, shows inline `<pre>`. Above,
 * wraps in `<details>` so the user can expand on demand. Browser-native
 * collapse — no React state.
 */
export const ToolIo = memo(function ToolIo({
  content,
  threshold = DEFAULT_THRESHOLD,
}: ToolIoProps) {
  if (content.length <= threshold) {
    return <pre className="tool-io">{content}</pre>;
  }
  return (
    <details className="tool-io">
      <summary>Tool I/O ({content.length} chars)</summary>
      <pre>{content}</pre>
    </details>
  );
});
