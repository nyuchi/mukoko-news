import { Sparkles } from 'lucide-react'

/**
 * The enrichment worker's summary of this article, labelled as machine-written.
 *
 * ## Why the label is not optional
 *
 * The design mock puts a card here headed **"Key takeaways"** with three
 * editorial-looking bullets. This app has no editorial takeaways: what it has
 * is `aiSummary`, one paragraph written by Qwen from the article body. Heading
 * that "Key takeaways" and setting it in the newsroom's own voice would tell
 * the reader a person distilled the piece for them. Nobody did.
 *
 * So the heading says what it is, the icon marks it, and the sodalite container
 * — the mineral Mzizi reserves for AI/Shamwari surfaces — carries it, exactly
 * as every other AI surface in the platform does. A reader can then decide how
 * much weight to give it, which is the entire point of saying so.
 *
 * Renders nothing when the article has no summary: unenriched articles are
 * common (the backlog runs into thousands at any moment) and an empty card that
 * says "no summary available" is worse than the reader simply reading on.
 */
export function ArticleSummary({ summary }: { summary?: string }) {
  const text = summary?.trim()
  if (!text) return null

  return (
    <section
      aria-labelledby="article-summary-heading"
      className="mb-8 rounded-2xl bg-container-sodalite p-5"
    >
      <h2
        id="article-summary-heading"
        className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-on-container-sodalite"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        AI summary
      </h2>
      <p className="text-base leading-relaxed text-on-container-sodalite">{text}</p>
    </section>
  )
}
