import { memo, useEffect, useState } from 'react';

interface CodeBlockProps {
  code: string;
  lang: string;
}

/**
 * Defer-loading Shiki code-block. The `shiki` import is dynamic so the
 * ~200kb gz bundle is fetched only on the first code-fence render. Falls
 * back to a plain `<pre><code>` block on language-not-found or load
 * failure. Memoized on (code, lang) so identical re-renders skip the
 * highlight pass.
 */
export const CodeBlock = memo(function CodeBlock({ code, lang }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import('shiki');
        if (cancelled) return;
        const out = await codeToHtml(code, { lang: lang || 'text', theme: 'github-dark' });
        if (!cancelled) setHtml(out);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html === null) {
    return (
      <pre className="shiki-fallback">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <div
      className="shiki-block"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is sanitized markup
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
