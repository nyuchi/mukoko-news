"use client";

import { useEffect, useState } from "react";

import { useMeter } from "@/hooks/use-meter";
import { MeterWall } from "@/components/access/meter-wall";

/**
 * The article body, counted against the anonymous reading allowance.
 *
 * ## The body is FADED, never removed
 *
 * When the allowance is spent this clips the body and puts a wall under it. It
 * does not unmount the children, and that is the single most important line in
 * this file. `robots.txt` here courts crawlers and answer engines, Googlebot
 * executes JavaScript, and an aggregator whose articles disappear from the
 * rendered DOM has deleted itself from search — the asset this product runs on.
 * A mask and a `max-height` leave every word in the document and change only
 * what a person can comfortably read.
 *
 * It is the same trade the AI summary already makes one card higher up: a
 * conversion gate over a payload the server has already sent, never a claim
 * that the content is unavailable. `@/lib/metering` carries the full reasoning.
 *
 * ## A crawler never reaches the wall anyway
 *
 * The count accumulates in `localStorage` on one device. A crawler arrives with
 * a fresh profile on every fetch, so its tally is always zero and it is always
 * inside the allowance. That is the mechanism — not an exemption list keyed on
 * a user agent, which would be a cloaking signal and could be spoofed by
 * anyone. There is nothing here to spoof.
 */
export function MeteredArticleBody({
  articleId,
  children,
}: {
  articleId: string;
  children: React.ReactNode;
}) {
  const { allowed, ready, used, record, hasCounted } = useMeter("articles");

  /**
   * ⚠️ The verdict is taken ON ARRIVAL, before this article is counted, and
   * then held. Both halves of that are load-bearing.
   *
   * **Before counting**, because the allowance is a number of articles the
   * reader gets, not a number they may have already had. Asking `allowed`
   * after spending the fiftieth says fifty is one too many, and a reader
   * promised fifty would receive forty-nine.
   *
   * **Held**, because a wall that materialises mid-paragraph over something you
   * were already reading is indistinguishable from the page breaking. The
   * decision belongs to the moment you opened the article.
   *
   * A first attempt derived this live from `hasCounted` instead, and it could
   * never wall anything at all: the effect below records the current article,
   * which makes `hasCounted` true for it a frame later, which reads as
   * already-paid-for. The test that opens one article too many is what found
   * that, and it is why the state is explicit rather than derived.
   *
   * `null` means not yet decided — the session or the count is still resolving.
   */
  const [admitted, setAdmitted] = useState<boolean | null>(null);

  // Spend one on arrival. Deduplicated by id, so a refresh, a back-navigation
  // or a second read of the same piece costs nothing — the allowance counts
  // articles, not page loads, which is what a reader would assume it means.
  useEffect(() => {
    if (!ready || !articleId || admitted !== null) return;
    // `allowed` here is still the pre-spend answer; `hasCounted` grandfathers
    // an article this reader already paid for, so reopening it at the limit
    // does not take it away.
    setAdmitted(allowed || hasCounted(articleId));
    record(articleId);
  }, [ready, articleId, admitted, allowed, hasCounted, record]);

  const walled = admitted === false;

  if (!walled) return <>{children}</>;

  return (
    <>
      {/*
        NOT `aria-hidden`. The top of this block is still on screen, and hiding
        visible content from assistive technology is a defect in its own right —
        it would make the article unreadable to a screen reader while a sighted
        reader can still see the first paragraphs, which is a worse outcome than
        the wall it is enforcing. The mask is a visual treatment; it is not a
        claim that the text is gone.
      */}
      <div className="relative mb-6 max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_40%,transparent)]">
        {children}
      </div>
      <div className="mb-8">
        <MeterWall
          title="That's your free reading on this device"
          had={`You've read ${used} articles here without an account, from the newsrooms we aggregate.`}
          promise="A free account makes reading unlimited, saves articles to the account rather than this browser, and opens the AI summaries."
        />
      </div>
    </>
  );
}
