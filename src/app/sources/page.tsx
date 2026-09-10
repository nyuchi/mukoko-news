"use client";

import { useState, useEffect, useMemo, useDeferredValue } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  Clock,
  Search,
  BadgeCheck,
} from "lucide-react";
import { SourceIcon } from "@/components/ui/source-icon";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { getSourcesAction, getSourceAuthorsAction } from "@/lib/actions/feed";
import type { SourceAuthor } from "@/lib/mongodb/sources";
import { COUNTRIES, getFullUrl } from "@/lib/constants";
import { useCoverage } from "@/contexts/coverage-context";
import { WebPageJsonLd } from "@/components/ui/json-ld";
import { formatTimeAgo } from "@/lib/utils";

interface Source {
  id: string;
  name: string;
  /** The feed endpoint. */
  url?: string;
  /** The publishing organisation's own homepage, from its own record. */
  site_url?: string;
  category?: string;
  country_id?: string;
  priority?: number;
  last_fetched_at?: string;
  fetch_count?: number;
  error_count?: number;
  last_error?: string;
  article_count?: number;
  latest_article_at?: string;
  verified?: boolean;
  publisher_tier?: string;
  /**
   * The newsroom (masthead) this feed delivers.
   *
   *   publisher / entity → newsroom (masthead) → source (this row)
   *
   * Optional because the organisation may not resolve, and an unresolved one is
   * grouped under no newsroom rather than under a placeholder.
   */
  newsroom_id?: string;
  newsroom_name?: string;
}

type SortKey = "articles" | "name" | "recent" | "errors";

const ERROR_RATE_THRESHOLD = 0.3;

function hasHighErrorRate(source: Source): boolean {
  const fetchCount = source.fetch_count || 0;
  const errorCount = source.error_count || 0;
  return fetchCount > 0 && errorCount / fetchCount > ERROR_RATE_THRESHOLD;
}

export default function SourcesPage() {
  const coverage = useCoverage();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [newsroomFilter, setNewsroomFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("");
  const deferredAuthor = useDeferredValue(authorFilter);
  const [authors, setAuthors] = useState<SourceAuthor[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("articles");

  useEffect(() => {
    async function fetchSources() {
      try {
        const [sources, authorIndex] = await Promise.all([
          getSourcesAction(),
          // Fetched alongside rather than after: the author filter is a
          // control on this page, so waiting for the directory first would
          // leave it disabled for a second on a cold cache for no reason.
          // Its own failure is contained — the action already fails soft to [].
          getSourceAuthorsAction(),
        ]);
        setSources(sources);
        setAuthors(authorIndex);
      } catch (err) {
        console.error("Failed to fetch sources:", err);
        setError("Unable to load sources. Please try again later.");
      } finally {
        setLoading(false);
      }
    }
    fetchSources();
  }, []);

  // Derive unique countries from sources for the filter
  const availableCountries = useMemo(() => {
    const codes = new Set(sources.map((s) => s.country_id).filter(Boolean));
    return COUNTRIES.filter((c) => codes.has(c.code));
  }, [sources]);

  /**
   * Newsrooms with at least one source, narrowed by the country filter.
   *
   * Narrowed deliberately: 537 mastheads in one select is not a control, it is
   * a scroll. Choosing a country first cuts it to that country's own — Kenya's
   * 24, Lesotho's 1 — which is how the two filters are actually used together.
   */
  const availableNewsrooms = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of sources) {
      if (!s.newsroom_id || !s.newsroom_name) continue;
      if (countryFilter !== "all" && s.country_id !== countryFilter) continue;
      byId.set(s.newsroom_id, s.newsroom_name);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources, countryFilter]);

  /**
   * The feed ids the typed byline files to, or null when no byline is typed.
   *
   * Matched on a case-insensitive substring so a half-typed name narrows as you
   * go, and `null` (not an empty Set) means "no author filter" — an empty Set
   * would be indistinguishable from "this author files to nothing" and would
   * silently blank the directory.
   */
  const authorSourceIds = useMemo(() => {
    const q = deferredAuthor.trim().toLowerCase();
    if (!q) return null;
    const ids = new Set<string>();
    for (const a of authors) {
      if (a.name.toLowerCase().includes(q)) for (const id of a.sourceIds) ids.add(id);
    }
    return ids;
  }, [authors, deferredAuthor]);

  // A country change can strand a newsroom selection that is not in the new
  // country. Clearing it is the honest reset: leaving it would filter to a
  // newsroom the country select says is not there, and show nothing.
  useEffect(() => {
    if (newsroomFilter === "all") return;
    if (!availableNewsrooms.some((n) => n.id === newsroomFilter)) setNewsroomFilter("all");
  }, [availableNewsrooms, newsroomFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = sources.length;
    const withArticles = sources.filter((s) => (s.article_count || 0) > 0).length;
    const totalArticles = sources.reduce((sum, s) => sum + (s.article_count || 0), 0);
    const withErrors = sources.filter(hasHighErrorRate).length;
    return { total, withArticles, totalArticles, withErrors };
  }, [sources]);

  // Filter & sort
  const filteredSources = useMemo(() => {
    let list = sources.filter((s) => {
      if (countryFilter !== "all" && s.country_id !== countryFilter) return false;
      if (newsroomFilter !== "all" && s.newsroom_id !== newsroomFilter) return false;
      if (authorSourceIds && !authorSourceIds.has(s.id)) return false;
      if (deferredSearch) {
        const q = deferredSearch.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.url?.toLowerCase().includes(q) ||
          s.category?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case "articles":
          return (b.article_count || 0) - (a.article_count || 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "recent":
          return (
            new Date(b.latest_article_at || 0).getTime() -
            new Date(a.latest_article_at || 0).getTime()
          );
        case "errors":
          return (b.error_count || 0) - (a.error_count || 0);
        default:
          return 0;
      }
    });

    return list;
  }, [sources, countryFilter, newsroomFilter, authorSourceIds, deferredSearch, sortBy]);

  if (loading) {
    return <SourcesPageSkeleton />;
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="p-8 text-center text-text-secondary">
          Failed to load sources page
        </div>
      }
    >
      <WebPageJsonLd
        name="News Sources — Mukoko News"
        description={`Browse all news sources on Mukoko News. View source health, article counts and coverage — ${coverage.fragment}.`}
        url={getFullUrl("/sources")}
      />
      <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Discover
          </Link>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            News Sources
          </h1>
          <p className="text-text-secondary">
            {stats.total} sources aggregating {stats.totalArticles.toLocaleString()} articles across Africa.
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total Sources" value={stats.total} />
          <StatCard label="Actively Publishing" value={stats.withArticles} />
          <StatCard label="Total Articles" value={stats.totalArticles} />
          <StatCard
            label="Fetch Issues"
            value={stats.withErrors}
            warn={stats.withErrors > 0}
          />
        </div>

        {/* Error banner */}
        {error && (
          <div className="p-4 mb-8 bg-container-terracotta border border-warning/30 rounded-xl text-sm text-on-container-terracotta">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sources..."
              aria-label="Search sources by name, URL, or category"
              className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-outline text-foreground placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            />
          </div>
          <select
            aria-label="Filter sources by country"
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="px-4 py-2.5 bg-surface rounded-xl border border-outline text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Countries</option>
            {availableCountries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          {/* Newsroom — the masthead a feed delivers. Separate from country
              because one masthead can be delivered by several feeds, so this is
              how a reader collapses The Herald's two endpoints into one
              newsroom. Hidden when the current country has nothing to choose
              between: a select with one option is a control that does nothing. */}
          {availableNewsrooms.length > 1 && (
            <select
              aria-label="Filter sources by newsroom"
              value={newsroomFilter}
              onChange={(e) => setNewsroomFilter(e.target.value)}
              className="px-4 py-2.5 bg-surface rounded-xl border border-control text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/50 max-w-[220px]"
            >
              <option value="all">All Newsrooms</option>
              {availableNewsrooms.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          )}

          {/* Author — a typeahead, not a select. There are 3,092 distinct
              bylines in a 30-day window; no dropdown holds that. The datalist
              offers the most prolific as suggestions while the input still
              accepts anything, so a partial name narrows as you type. Hidden
              entirely when the index failed to load rather than rendering a
              control that silently matches nothing. */}
          {authors.length > 0 && (
            <div className="relative">
              <input
                type="text"
                list="source-authors"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                placeholder="Filter by author..."
                aria-label="Filter sources by author byline"
                className="w-full sm:w-[200px] px-4 py-2.5 bg-surface rounded-xl border border-control text-foreground placeholder:text-text-tertiary text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
              <datalist id="source-authors">
                {authors.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.articleCount} articles
                  </option>
                ))}
              </datalist>
            </div>
          )}

          <select
            aria-label="Sort sources"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-4 py-2.5 bg-surface rounded-xl border border-outline text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="articles">Most Articles</option>
            <option value="recent">Most Recent</option>
            <option value="name">Name A-Z</option>
            <option value="errors">Most Errors</option>
          </select>
        </div>

        {/* Source list */}
        <div className="space-y-3">
          {filteredSources.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">
              No sources match your filters.
            </div>
          ) : (
            filteredSources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

function StatCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="p-4 bg-surface rounded-xl border border-outline">
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      <p
        className={`text-2xl font-bold ${warn ? "text-warning" : "text-foreground"}`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const country = COUNTRIES.find((c) => c.code === source.country_id);
  const articleCount = source.article_count || 0;
  const hasIssues = hasHighErrorRate(source);
  const isInactive = articleCount === 0;

  return (
    <div
      className={`flex items-center gap-4 p-4 bg-surface rounded-xl border transition-colors ${
        hasIssues
          ? "border-warning/40"
          : isInactive
            ? "border-elevated opacity-60"
            : "border-elevated hover:border-primary/30"
      }`}
    >
      {/* Source icon */}
      <SourceIcon
        source={source.name}
        organizationUrl={source.site_url}
        sourceUrl={source.url}
        size={36}
      />

      {/* Source info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/discover?source=${encodeURIComponent(source.name)}`}
            className="font-medium text-foreground hover:text-primary transition-colors truncate"
          >
            {source.name}
          </Link>
          {source.verified && (
            <span
              className="inline-flex items-center gap-1 shrink-0 rounded-full bg-container-sodalite px-1.5 py-0.5 text-[10px] font-medium text-on-container-sodalite"
              title="Verified publisher"
            >
              <BadgeCheck className="w-3 h-3" />
              Verified
            </span>
          )}
          {country && (
            <span className="text-sm shrink-0" title={country.name}>
              {country.flag}
            </span>
          )}
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-tertiary hover:text-primary transition-colors shrink-0"
              title="Visit RSS feed"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
          {source.category && (
            <span className="capitalize">{source.category}</span>
          )}
          {source.latest_article_at && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(source.latest_article_at)}
            </span>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Article count */}
        <div className="text-right">
          <p
            className={`text-sm font-semibold ${isInactive ? "text-text-tertiary" : "text-foreground"}`}
          >
            {articleCount.toLocaleString()}
          </p>
          <p className="text-xs text-text-tertiary">articles</p>
        </div>

        {/* Status indicator */}
        <div className="w-6 flex justify-center" title={statusTitle(source)}>
          {hasIssues ? (
            <AlertTriangle className="w-4 h-4 text-warning" />
          ) : articleCount > 0 ? (
            <CheckCircle className="w-4 h-4 text-success" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-text-tertiary" />
          )}
        </div>
      </div>
    </div>
  );
}

function statusTitle(source: Source): string {
  if (hasHighErrorRate(source)) {
    const errorCount = source.error_count || 0;
    const fetchCount = source.fetch_count || 0;
    return `High error rate: ${errorCount} errors in ${fetchCount} fetches${source.last_error ? ` — ${source.last_error}` : ""}`;
  }
  if ((source.article_count || 0) === 0) {
    return "No articles collected yet";
  }
  return `Healthy — ${source.article_count} articles, ${source.fetch_count || 0} fetches`;
}

function SourcesPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-8"
      aria-label="Loading sources"
      role="status"
      aria-live="polite"
    >
      <Skeleton className="h-4 w-32 mb-4" />
      <Skeleton className="h-9 w-48 mb-2" />
      <Skeleton className="h-5 w-80 mb-8" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      <div className="flex gap-3 mb-8">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 w-40 rounded-xl" />
        <Skeleton className="h-11 w-40 rounded-xl" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
