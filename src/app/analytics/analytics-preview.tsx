import Link from "next/link";
import { BarChart3, Building2, Globe2, Lock, Tags } from "lucide-react";

import { ErrorBoundary } from "@/components/ui/error-boundary";
import type { CorpusPreview } from "@/lib/mongodb/analytics";

/**
 * What an anonymous reader sees at `/analytics`.
 *
 * ## Why this page exists at all
 *
 * `/insights` is open and links into `/analytics`, so following a topic to go
 * deeper is the single most common moment a reader decides whether this platform
 * is worth an account. That moment used to be a `redirect` to `/sign-in`: the
 * page they were reading vanished and a form appeared that said nothing about
 * what was behind it. The ask was to stop keeping people out and start bringing
 * them in, and a login form is the least persuasive thing that can occupy that
 * screen.
 *
 * So this renders the reader's OWN query, answered, with the panels that need a
 * session shown as locked rather than omitted. It is the same rule the AI
 * summary gate follows and for the same measured reason: a feature that simply
 * disappears converts nobody, because they never learn it exists.
 *
 * ## The one honesty rule
 *
 * A locked panel must never be confused with an empty one. `CorpusPreview` has
 * no field for the withheld breakdowns — they are absent from the type, not
 * zeroed in it — so this component cannot accidentally render "no named entities
 * for this query" over data it was never given. And when `answered` is false the
 * page says we could not run the query rather than showing a zero, because a
 * zero here would be a claim about the corpus rather than about our indexes.
 */

function formatNumber(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}

/** Describe the query in words, so the reader sees their question restated. */
export function describePreviewQuery(preview: CorpusPreview): string {
  const { query } = preview;
  const parts = [
    query.q ? `“${query.q}”` : null,
    query.countries.length ? `in ${query.countries.join(", ")}` : null,
    query.categories.length
      ? `categorised ${query.categories.join(", ")}`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "all articles";
}

function Bars({
  rows,
}: {
  rows: Array<{ key: string; label: string; value: number }> | null;
}) {
  /*
   * `null` and `[]` are different answers and must not read the same.
   *
   * `null` means the Search index serving this query carries no such facet —
   * a text term routes to `articles_text_search`, which maps no category,
   * keyword or sentiment path. Saying "No data for this query" there states
   * something about the corpus that we never measured, which is the failure
   * this file's own header comment forbids two panels above.
   */
  if (rows === null) {
    return (
      <p className="text-sm text-text-tertiary">
        Not available for a text search — add a country or date filter instead,
        or sign in for the full console.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">No data for this query.</p>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-foreground">
              {row.label}
            </span>
            <span className="shrink-0 font-mono text-xs text-text-secondary">
              {formatNumber(row.value)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, 1.5)}%`,
                backgroundColor: "var(--chart-primary)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Building2;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-outline bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The locked panels, named rather than hidden.
 *
 * Naming them is the whole conversion argument: "sign in for more" is a promise
 * with no content, and these four are specific, checkable and exactly what a
 * reader looking at a topic breakdown would want next.
 */
const LOCKED = [
  {
    title: "Named entities",
    detail:
      "The people, organisations and places this coverage is actually about.",
  },
  {
    title: "Bylines",
    detail:
      "Which journalists are credited, and what share of the coverage carries a byline.",
  },
  {
    title: "The articles themselves",
    detail: "A sample of the matching stories, with links.",
  },
  {
    title: "CSV and JSON export",
    detail: "The whole matched slice, as a file you can work with.",
  },
];

export default function AnalyticsPreview({
  preview,
  returnTo,
}: {
  preview: CorpusPreview;
  returnTo: string;
}) {
  const signIn = `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  const described = describePreviewQuery(preview);

  return (
    <ErrorBoundary
      fallback={
        <div className="p-8 text-center text-text-secondary">
          Failed to render analytics
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] py-[var(--page-block)] sm:px-[var(--page-gutter-sm)]">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-3">
            <BarChart3 className="h-7 w-7 text-primary" aria-hidden="true" />
            <h1 className="text-3xl font-bold text-foreground">Analytics</h1>
          </div>
          <p className="max-w-2xl text-text-secondary">
            Query the corpus directly: any topic, any country, any window. Every
            figure is computed live from the articles we aggregate.
          </p>
        </header>

        {preview.answered ? (
          <>
            <div className="mb-6 rounded-2xl border border-outline bg-surface p-5">
              <p className="text-sm text-text-secondary">Showing {described}</p>
              <p className="mt-1 font-mono text-3xl font-bold text-foreground">
                {formatNumber(preview.total)}
                <span className="ml-2 font-sans text-sm font-normal text-text-tertiary">
                  articles
                </span>
              </p>
            </div>

            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <Panel title="Who is covering it" icon={Building2}>
                <Bars
                  rows={preview.bySource.map((s) => ({
                    key: s.sourceId,
                    label: s.name,
                    value: s.count,
                  }))}
                />
              </Panel>
              <Panel title="Where it is being covered" icon={Globe2}>
                <Bars
                  rows={preview.byCountry.map((c) => ({
                    key: c.code,
                    label: c.name,
                    value: c.count,
                  }))}
                />
              </Panel>
              <Panel title="Topics" icon={Tags}>
                <Bars
                  rows={
                    preview.byKeyword?.map((k) => ({
                      key: k.term,
                      label: k.term,
                      value: k.count,
                    })) ?? null
                  }
                />
              </Panel>
              <Panel title="Categories" icon={Tags}>
                <Bars
                  rows={
                    preview.byCategory?.map((c) => ({
                      key: c.term,
                      label: c.term,
                      value: c.count,
                    })) ?? null
                  }
                />
              </Panel>
            </div>
          </>
        ) : (
          /*
           * Not "no results". `answered: false` means no Search index can express
           * this query shape, and the only other way to answer it is the document
           * scan the preview will not run for an anonymous caller. Rendering a
           * zero here would state something about the corpus that we did not
           * measure.
           */
          <div className="mb-8 rounded-2xl border border-outline bg-surface p-5">
            <p className="text-sm text-text-secondary">
              We couldn&apos;t summarise {described} without running the full
              query. Signing in runs it in full.
            </p>
          </div>
        )}

        <section className="rounded-2xl border border-outline bg-container-tanzanite p-6 text-on-container-tanzanite">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Lock className="h-5 w-5" aria-hidden="true" />
            Four more panels on this query
          </h2>
          <p className="mt-1 text-sm opacity-90">
            A free account opens the rest of the console — on this query and any
            other.
          </p>
          <ul className="mt-4 space-y-3">
            {LOCKED.map((item) => (
              <li key={item.title}>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="text-sm opacity-90">{item.detail}</p>
              </li>
            ))}
          </ul>
          <Link
            href={signIn}
            className="mt-5 inline-flex min-h-[var(--density-touch)] items-center justify-center rounded-[var(--radius-button,12px)] bg-primary px-6 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
          >
            Create a free account
          </Link>
          <p className="mt-3 text-xs opacity-80">
            You&apos;ll come straight back to this query.
          </p>
        </section>

        <p className="mt-6 text-sm text-text-secondary">
          Everything above is open data.{" "}
          <Link
            href="/insights"
            className="text-primary underline underline-offset-2"
          >
            Insights
          </Link>{" "}
          publishes the platform-wide version, with a public export and no
          account needed.
        </p>
      </div>
    </ErrorBoundary>
  );
}
