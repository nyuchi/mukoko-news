"use client";

import ReactMarkdown from "react-markdown";
import { imageProxyUrl } from "@/lib/image";
import { isValidImageUrl } from "@/lib/utils";

/**
 * Render Markdown as styled React elements. Used for article bodies
 * (`article.content_markdown`, produced by the pipeline from the sanitized HTML).
 *
 * Security: react-markdown does NOT render raw HTML embedded in the Markdown by
 * default (no `rehype-raw`), so any stray `<script>`/`<img onerror>` in the source
 * is emitted as literal text, never live DOM — no `dangerouslySetInnerHTML` and no
 * separate sanitizer needed. Links are forced to open safely in a new tab.
 *
 * Inline body images (`![](…)`) are third-party publisher URLs, so they go through
 * the image-worker proxy just like every other article image — otherwise the raw
 * cross-origin fetch is slow, hotlink-blocked, or dropped by OpaqueResponseBlocking.
 * Unsafe/relative srcs are skipped (`isValidImageUrl`) rather than rendered raw.
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
          img: ({ src, alt }) => {
            if (typeof src !== "string" || !isValidImageUrl(src)) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageProxyUrl(src, { width: 900 })}
                alt={alt ?? ""}
                loading="lazy"
                className="rounded-lg"
              />
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
