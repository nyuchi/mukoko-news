'use client';

import { useEffect, useState } from 'react';
import { Clock, FileText, Radio, ShieldAlert, ShieldCheck, ExternalLink } from 'lucide-react';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import type { Article } from '@/lib/api';
import { getArticleProvenanceAction } from '@/lib/actions/article-metrics';
import type { ArticleProvenance } from '@/lib/mongodb/article-metrics';

/**
 * Article metrics — what this page can honestly say about one article.
 *
 * ## The rule the whole file is built around
 *
 * **A metric that is absent is absent.** Not `0`, not "0%", not "—", not "no
 * issues found". Every row below is wrapped in a presence check and disappears
 * when the underlying field is missing, because the repo's country-backfill
 * precedent applies to display exactly as it applies to writes: a null is a
 * known gap, a wrong value is a silent error shown to readers as fact.
 *
 * Two consequences that are easy to get wrong and are load-bearing here:
 *
 * 1. `qualityScore` is present on 100% of the corpus but is `0` on every
 *    un-enriched article (an ingestion default, not a score). The read module
 *    turns that into `null`; this file never prints a `0` score.
 * 2. An article with no `linkAuditedAt` has NOT been found clean — it has not
 *    been looked at. `linkAudit === null` renders "not audited", and the words
 *    "no spam links" appear only when an audit actually ran.
 *
 * ## Where the reader/staff line is drawn, and why
 *
 * READER: facts about the article as a piece of writing — how long it is, when
 * it was published, who wrote it, who published it and where to read the
 * original. Things a person uses to decide whether to read something.
 *
 * STAFF: facts about how *Mukoko* processed it — quality scoring, sentiment
 * classification, enrichment timing, ingestion and full-text strategy, the
 * outbound-link audit. These describe the pipeline, not the journalism, and
 * the quality score in particular would be actively misleading in public: the
 * pipeline's own incident notes record a gambling-SEO spam article scoring
 * 0.75 with `content_depth` 0.7 because it was long and fluent. A reader shown
 * "quality 0.75" would read a verdict on the reporting. Staff reading the same
 * number know it is a signal about text shape. Same number, different claim.
 */

/** Only the fields this panel renders; keeps the component testable in isolation. */
type ArticleMetricsInput = Pick<
  Article,
  'id' | 'source' | 'original_url' | 'published_at' | 'word_count' | 'reading_time' | 'author'
>;

/** An absolute http(s) URL, or nothing — a `javascript:` href must never render. */
function externalHref(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * The two reader metrics that belong at the DECIDE-TO-READ moment, beside the
 * source and the date rather than at the foot of the article.
 *
 * Rendered as a fragment so it drops straight into the header's metadata row.
 * Both halves are independently optional: `reading_time` is on 100% of the
 * corpus, a byline on 46%, and an article with neither renders nothing at all
 * rather than an empty separator.
 */
export function ArticleReadingMeta({ article }: { article: ArticleMetricsInput }) {
  const minutes = typeof article.reading_time === 'number' && article.reading_time > 0
    ? article.reading_time
    : null;
  const byline = article.author?.trim() || null;

  return (
    <>
      {minutes !== null && (
        <span className="flex items-center gap-1">
          <Clock className="w-4 h-4" aria-hidden="true" />
          {minutes} min read
        </span>
      )}
      {/* Deliberately sets no colour: this fragment drops into the header's
          metadata row and must inherit whatever ink that row is set in. */}
      {byline && <span className="font-medium">By {byline}</span>}
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <dt className="font-mono text-[12px] uppercase tracking-wide text-text-tertiary min-w-[9rem]">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

const SENTIMENT_STYLE: Readonly<Record<string, string>> = {
  positive: 'bg-container-malachite text-on-container-malachite',
  negative: 'bg-container-terracotta text-on-container-terracotta',
  neutral: 'bg-container-cobalt text-on-container-cobalt',
  mixed: 'bg-container-gold text-on-container-gold',
};

/** Closed maps: an unrecognised value is shown verbatim, never renamed. */
const INGESTION_LABELS: Readonly<Record<string, string>> = {
  rss_feed: 'RSS feed',
  newsdata_api: 'newsdata.io',
};

const FULLTEXT_LABELS: Readonly<Record<string, string>> = {
  'wp-json': 'WordPress API (post id)',
  'wp-json-slug': 'WordPress API (slug)',
  extraction: 'Page extraction',
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-[var(--touch-badge)] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${tone}`}
    >
      {children}
    </span>
  );
}

/**
 * The outbound-link audit, in its three genuinely distinct states.
 *
 * The middle state is the one that does not exist in most UIs and is the whole
 * point of this block: "audited, nothing matched" and "never audited" look
 * identical in the document (both have no `spamLinkDomains`) and mean opposite
 * things. 63,832 of 63,834 articles are in the second state today.
 */
function LinkAuditRow({ audit }: { audit: ArticleProvenance['linkAudit'] }) {
  if (!audit) {
    return (
      <MetaRow label="Link audit">
        <span className="text-text-tertiary">Not audited</span>
        <span className="block text-xs text-text-tertiary">
          No outbound-link audit has run on this article. That is not a finding of
          &ldquo;clean&rdquo; — it is the absence of a finding.
        </span>
      </MetaRow>
    );
  }

  const auditedOn = formatDate(audit.auditedAt);
  const flagged = audit.spamDomains.length > 0;

  return (
    <MetaRow label="Link audit">
      <span className="flex flex-wrap items-center gap-2">
        {flagged ? (
          <Badge tone="bg-container-terracotta text-on-container-terracotta">
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            {audit.spamDomains.length} flagged {audit.spamDomains.length === 1 ? 'domain' : 'domains'}
          </Badge>
        ) : (
          <Badge tone="bg-container-malachite text-on-container-malachite">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            No spam links matched
          </Badge>
        )}
        {audit.outboundLinks !== null && (
          <span className="text-text-secondary">
            {audit.outboundLinks} outbound {audit.outboundLinks === 1 ? 'link' : 'links'}
          </span>
        )}
        {auditedOn && <span className="text-text-tertiary text-xs">audited {auditedOn}</span>}
      </span>
      {flagged && (
        // The ink is the container's own `on-container` pair, so it sits on the
        // terracotta fill rather than borrowing that ink onto the card.
        <span className="mt-2 block rounded-xl bg-container-terracotta px-3 py-2 font-mono text-xs text-on-container-terracotta">
          {audit.spamDomains.join(', ')}
          {audit.spamReasons.length > 0 && ` — ${audit.spamReasons.join(', ')}`}
        </span>
      )}
    </MetaRow>
  );
}

/**
 * The staff panel. Everything in it is a statement about the PIPELINE.
 *
 * The coverage caption follows the `/insights` precedent (`Coverage: N% of the
 * corpus is enriched …`) rather than inventing a second way of qualifying a
 * subset. When the corpus counts cannot be read the caption says so — a
 * caption that silently omitted the qualifier would present a subset metric as
 * a whole-corpus one.
 */
function ProvenanceSection({ provenance }: { provenance: ArticleProvenance }) {
  const {
    enriched,
    enrichedAt,
    qualityScore,
    qualitySignals,
    sentiment,
    keywordCount,
    namedEntityCount,
    hasSummary,
    topics,
    ingestionMethod,
    fulltextMethod,
    fulltextFetchedAt,
    newsdataEnhancedAt,
    linkAudit,
    coverage,
  } = provenance;

  const enrichedOn = formatDate(enrichedAt);
  const fulltextOn = formatDate(fulltextFetchedAt);
  const enhancedOn = formatDate(newsdataEnhancedAt);

  return (
    <section className="mt-6 rounded-2xl border border-outline bg-elevated p-5" aria-label="Pipeline provenance">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-base font-bold text-foreground">Pipeline provenance</h3>
        <Badge tone="bg-container-sodalite text-on-container-sodalite">Staff only</Badge>
      </div>

      <p className="mt-2 text-xs text-text-tertiary">
        {coverage
          ? `Quality and sentiment are computed on the enriched corpus — ${coverage.percent}% of articles (${formatNumber(coverage.enriched)} of ${formatNumber(coverage.total)}). `
          : 'Quality and sentiment are computed on the enriched subset of the corpus; its current size could not be read. '}
        These describe how the pipeline processed the text, not the quality of the
        reporting.
      </p>

      <dl className="mt-3 divide-y divide-border">
        <MetaRow label="Enrichment">
          {enriched ? (
            <span>
              Enriched
              {enrichedOn && <span className="text-text-secondary"> · {enrichedOn}</span>}
            </span>
          ) : (
            <span className="text-text-tertiary">
              Not enriched — no quality score, sentiment or keywords exist for this article
            </span>
          )}
        </MetaRow>

        {qualityScore !== null && (
          <MetaRow label="Quality score">
            <span className="font-mono">{qualityScore.toFixed(2)}</span>
            <span className="text-text-tertiary"> / 1.00</span>
          </MetaRow>
        )}

        {qualitySignals.length > 0 && (
          <MetaRow label="Quality signals">
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {qualitySignals.map((signal) => (
                <span key={signal.key} className="text-text-secondary">
                  {signal.label} <span className="font-mono text-foreground">{signal.value.toFixed(2)}</span>
                </span>
              ))}
            </span>
          </MetaRow>
        )}

        {sentiment && (
          <MetaRow label="Sentiment">
            <Badge tone={SENTIMENT_STYLE[sentiment] ?? 'bg-surface text-text-secondary'}>
              {sentiment}
            </Badge>
          </MetaRow>
        )}

        {(keywordCount !== null || namedEntityCount !== null || hasSummary) && (
          <MetaRow label="Extracted">
            <span className="text-text-secondary">
              {[
                keywordCount !== null ? `${keywordCount} keywords` : null,
                namedEntityCount !== null ? `${namedEntityCount} named entities` : null,
                hasSummary ? 'AI summary' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </MetaRow>
        )}

        {topics.length > 0 && (
          <MetaRow label="Topics">
            <span className="font-mono text-xs text-text-secondary">{topics.join(', ')}</span>
          </MetaRow>
        )}

        {ingestionMethod && (
          <MetaRow label="Ingested via">
            <span>{INGESTION_LABELS[ingestionMethod] ?? ingestionMethod}</span>
          </MetaRow>
        )}

        {fulltextMethod && (
          <MetaRow label="Full text">
            <span>{FULLTEXT_LABELS[fulltextMethod] ?? fulltextMethod}</span>
            {fulltextOn && <span className="text-text-tertiary"> · {fulltextOn}</span>}
          </MetaRow>
        )}

        {enhancedOn && (
          <MetaRow label="newsdata merge">
            <span className="text-text-secondary">{enhancedOn}</span>
          </MetaRow>
        )}

        <LinkAuditRow audit={linkAudit} />
      </dl>
    </section>
  );
}

/**
 * Staff provenance, fetched on demand.
 *
 * `useAuth()` decides only whether to ASK — it is a hint that avoids a pointless
 * round trip for the anonymous majority, never a permission check. The Server
 * Action re-derives the tier from the verified session and returns `null` to
 * everyone else, so a patched client gets nothing.
 */
function StaffProvenance({ articleId }: { articleId: string }) {
  const { user } = useAuth();
  const [provenance, setProvenance] = useState<ArticleProvenance | null>(null);

  useEffect(() => {
    if (!user) {
      setProvenance(null);
      return;
    }
    let active = true;
    getArticleProvenanceAction(articleId)
      .then((result) => {
        if (active) setProvenance(result);
      })
      // A reader-facing page must not surface a staff-panel failure; the panel
      // simply does not appear.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [articleId, user]);

  if (!provenance) return null;
  return <ProvenanceSection provenance={provenance} />;
}

/**
 * "About this article" — the reader-facing block, plus the staff panel for the
 * callers entitled to it.
 *
 * Everything here comes from the ISR-cached `Article` the page already holds;
 * the only extra request is the staff one, and only signed-in callers make it.
 */
export function ArticleMetricsPanel({ article }: { article: ArticleMetricsInput }) {
  const words = typeof article.word_count === 'number' && article.word_count > 0
    ? article.word_count
    : null;
  const minutes = typeof article.reading_time === 'number' && article.reading_time > 0
    ? article.reading_time
    : null;
  const byline = article.author?.trim() || null;
  const publishedOn = formatDate(article.published_at);
  const sourceHref = externalHref(article.original_url);
  const sourceName = article.source?.trim() || null;

  const length = [
    words !== null ? `${formatNumber(words)} words` : null,
    minutes !== null ? `${minutes} min read` : null,
  ].filter(Boolean);

  return (
    <section className="mt-8" aria-labelledby="about-this-article">
      <h2
        id="about-this-article"
        className="font-mono text-[13px] uppercase tracking-wide text-text-tertiary"
      >
        About this article
      </h2>

      <dl className="mt-2 divide-y divide-border rounded-2xl border border-outline bg-surface px-5 py-1">
        {length.length > 0 && (
          <MetaRow label="Length">
            <span className="flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-text-tertiary" aria-hidden="true" />
              {length.join(' · ')}
            </span>
          </MetaRow>
        )}

        {publishedOn && <MetaRow label="Published">{publishedOn}</MetaRow>}

        {byline && <MetaRow label="Byline">{byline}</MetaRow>}

        {sourceName && (
          <MetaRow label="Source">
            <span className="flex flex-wrap items-center gap-2">
              <Radio className="w-4 h-4 text-text-tertiary" aria-hidden="true" />
              {sourceHref ? (
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-foreground underline underline-offset-2 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {sourceName}
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              ) : (
                sourceName
              )}
            </span>
          </MetaRow>
        )}
      </dl>

      <StaffProvenance articleId={article.id} />
    </section>
  );
}
