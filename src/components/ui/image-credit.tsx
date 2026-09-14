import Link from "next/link";

import type { Article } from "@/lib/api";

/**
 * Who supplied the photograph on an article, said in the only terms we can
 * prove.
 *
 * ## The corpus carries no photographer and no agency
 *
 * Measured on the live cluster 2026-09-14 over the 20,000 most recent
 * articles: every one stores its image as the schema.org array shape, and the
 * sub-document has exactly TWO keys — `@type` and `url`. There is no
 * `creditText`, no `imageCredit`, no `copyrightHolder`, no caption; a scan for
 * all four across the same window returns zero. Neither collector writes one,
 * and the enrichment write surface does not include one either.
 *
 * So the platform does not know who took the picture. It knows one thing, and
 * knows it exactly: **the publisher handed us this image with this article**.
 * That is what the credit says, and it is why the wording is `via` rather than
 * `Photo:` — "Photo: The Herald" asserts that The Herald made the photograph,
 * which for a wire picture is simply false, and a false credit printed under
 * somebody's copyrighted work is worse than none. `via` claims only the route.
 *
 * ## The image host is not a credit, so it is not shown
 *
 * The obvious second fact — the host serving the file — was measured and
 * rejected. Of the recent articles carrying both an image and an article URL,
 * 5,005 of 12,267 (41%) serve the image from a different host than the article,
 * and the top of that list is `i0.wp.com`, `blogger.googleusercontent.com`,
 * `cdn.punchng.com`, `assets.citizen.digital`, `s.france24.com` — that is, the
 * publisher's own CDN subdomain or a generic image proxy. Printing it would
 * credit Automattic and Google for African newsrooms' photography. It is
 * infrastructure, not provenance.
 *
 * ## Which name
 *
 * `publisher.name` is the masthead, resolved on read from the article's
 * `mediaOrganizationId`; `source` is the FEED, a delivery endpoint whose name
 * can disagree with the masthead's. The masthead is who published, so it wins —
 * but it is only resolved on the single-article read, so the feed name is the
 * fallback rather than a lesser answer. With neither, the component renders
 * NOTHING: a credit reading "via Unknown" over a real photographer's work is
 * exactly the invented verdict the rest of this codebase refuses to print.
 */
export function imageCreditName(
  article: Pick<Article, "publisher" | "source">,
): string | null {
  const name = article.publisher?.name?.trim() || article.source?.trim();
  return name || null;
}

/** The rendered string, so a surface that cannot mount a component can still say it. */
export function imageCreditText(
  article: Pick<Article, "publisher" | "source">,
): string | null {
  const name = imageCreditName(article);
  return name ? `Image via ${name}` : null;
}

const PLACE_CLASS = {
  "top-right": "top-2 right-2",
  "bottom-right": "bottom-2 right-2",
} as const;

/**
 * `caption` sits under an image presented at size and is the fuller statement —
 * it links to the Terms section that explains the rights position, because the
 * article page is where a reader has room to follow it.
 *
 * `overlay` is for an image that IS the surface (the hero card, a NewsByte, a
 * story cluster) where there is no "under" to sit in. It rides on a black wash
 * rather than a theme token on purpose: it is over a photograph, and a
 * photograph is not light or dark by the reader's preference.
 *
 * `inline` is for a caption block already sitting on the photograph over its
 * own scrim.
 */
export function ImageCredit({
  article,
  variant = "caption",
  place = "bottom-right",
  className = "",
}: {
  article: Pick<Article, "publisher" | "source">;
  variant?: "caption" | "overlay" | "inline";
  /**
   * Which corner the overlay takes. A prop rather than a `className` override
   * because Tailwind utilities do not cascade by string order — an appended
   * `top-2` and the base `bottom-2` would both be in the stylesheet and the
   * winner would be whichever the build emitted last, which is not a decision
   * this file gets to make.
   */
  place?: keyof typeof PLACE_CLASS;
  className?: string;
}) {
  const name = imageCreditName(article);
  if (!name) return null;

  if (variant === "inline") {
    // For a caption block that is ALREADY sitting on the photograph over its
    // own scrim — a NewsByte, an embed hero. A second wash and a second corner
    // would read as a separate control floating over the first.
    return (
      <span className={`block text-xs text-white/60 ${className}`.trim()}>
        Image via {name}
      </span>
    );
  }

  if (variant === "overlay") {
    return (
      <span
        className={`pointer-events-none absolute z-10 max-w-[70%] truncate rounded-full bg-black/60 px-2 py-0.5 text-[10px] leading-4 text-white/80 backdrop-blur-sm ${PLACE_CLASS[place]} ${className}`.trim()}
      >
        Image via {name}
      </span>
    );
  }

  return (
    <figcaption
      className={`px-[var(--page-gutter)] pt-2 text-xs text-text-tertiary sm:px-[var(--page-gutter-sm)] ${className}`.trim()}
    >
      Image via {name}. Supplied with the article;{" "}
      <Link
        href="/terms#images"
        className="underline hover:text-text-secondary"
      >
        rights remain with the copyright holder
      </Link>
      .
    </figcaption>
  );
}
