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
} from "lucide-react";
import { SourceIcon } from "@/components/ui/source-icon";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { getSourcesAction } from "@/lib/actions/feed";
import { COUNTRIES, getFullUrl } from "@/lib/constants";
import { WebPageJsonLd } from "@/components/ui/json-ld";
import { formatTimeAgo } from "@/lib/utils";

interface Source {
  id: string;
  name: string;
  url?: string;
  category?: string;
  country_id?: string;
  priority?: number;
  last_fetched_at?: string;
  fetch_count?: number;
  error_count?: number;
  last_error?: string;
  article_count?: number;
  latest_article_at?: string;
}

type SortKey = "articles" | "name" | "recent" | "errors";

const ERROR_RATE_THRESHOLD = 0.3;

function hasHighErrorRate(source: Source): boolean {
  const fetchCount = source.fetch_count || 0;
  const errorCount = source.error_count || 0;
  return fetchCount > 0 && errorCount / fetchCount > ERROR_RATE_THRESHOLD;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("articles");

  useEffect(() => {
    async function fetchSources() {
      try {
        const sources = await getSourcesAction();
        setSources(sources);
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
  }, [sources, countryFilter, deferredSearch, sortBy]);

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
        description="Browse all news sources on Mukoko News. View source health, article counts, and coverage across 16 African countries."
        url={getFullUrl("/sources")}
      />
      <div className="max-w-[1200px] mx-auto px-6 py-8">
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
          <div className="p-4 mb-8 bg-orange-500/10 border border-orange-500/30 rounded-xl text-sm text-orange-400">
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
              className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-xl border border-elevated text-foreground placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            />
          </div>
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="px-4 py-2.5 bg-surface rounded-xl border border-elevated text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Countries</option>
            {availableCountries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-4 py-2.5 bg-surface rounded-xl border border-elevated text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/50"
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
    <div className="p-4 bg-surface rounded-xl border border-elevated">
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      <p
        className={`text-2xl font-bold ${warn ? "text-orange-400" : "text-foreground"}`}
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
          ? "border-orange-500/30"
          : isInactive
            ? "border-elevated opacity-60"
            : "border-elevated hover:border-primary/30"
      }`}
    >
      {/* Source icon */}
      <SourceIcon source={source.name} size={36} />

      {/* Source info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/discover?source=${encodeURIComponent(source.name)}`}
            className="font-medium text-foreground hover:text-primary transition-colors truncate"
          >
            {source.name}
          </Link>
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
            <AlertTriangle className="w-4 h-4 text-orange-400" />
          ) : articleCount > 0 ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
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
      className="max-w-[1200px] mx-auto px-6 py-8"
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
