"use client";

import ReactMarkdown from "react-markdown";

/**
 * Render Markdown as styled React elements. Used for article bodies
 * (`article.content_markdown`, produced by the pipeline from the sanitized HTML).
 *
 * Security: react-markdown does NOT render raw HTML embedded in the Markdown by
 * default (no `rehype-raw`), so any stray `<script>`/`<img onerror>` in the source
 * is emitted as literal text, never live DOM — no `dangerouslySetInnerHTML` and no
 * separate sanitizer needed. Links are forced to open safely in a new tab.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-lg dark:prose-invert max-w-none">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
