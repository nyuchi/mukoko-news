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
/**
 * Decode HTML entities that survive the pipeline's HTML→Markdown rendition
 * (e.g. `&#8230;` in WordPress excerpts). Safe: react-markdown escapes its
 * output, so decoded characters render as text, never as live HTML.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

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
        {decodeHtmlEntities(children)}
      </ReactMarkdown>
    </div>
  );
}
