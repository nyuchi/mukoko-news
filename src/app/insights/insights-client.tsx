"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  ChevronRight,
  BarChart3,
  Users,
  Newspaper,
  Layers,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import {
  getStatsAction,
  getTrendingCategoriesAction,
  getTrendingAuthorsAction,
} from "@/lib/actions/feed";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { InsightsPageSkeleton } from "@/components/ui/skeleton";

// Category emojis
const CATEGORY_EMOJIS: Record<string, string> = {
  politics: "🏛️",
  business: "💼",
  sports: "⚽",
  entertainment: "🎬",
  technology: "💻",
  health: "🏥",
  world: "🌍",
  local: "📍",
  opinion: "💭",
  breaking: "⚡",
  crime: "🚨",
  education: "📚",
  environment: "🌱",
  lifestyle: "✨",
  agriculture: "🌾",
  mining: "⛏️",
  tourism: "✈️",
  finance: "💰",
  culture: "🎭",
};

const getEmoji = (name: string) => CATEGORY_EMOJIS[name?.toLowerCase()] || "📰";

export interface Stats {
  total_articles: number;
  active_sources: number;
  categories: number;
}

export interface TrendingCategory {
  id: string;
  name: string;
  slug: string;
  article_count: number;
  growth_rate?: number;
}

export interface Author {
  id: string;
  name: string;
  article_count: number;
}

/**
 * Some ingested articles store `author` as a schema.org object
 * (`{"@type": "Person", "name": "…"}`) rather than a string, so the
 * trending-authors aggregation can return objects in `id`/`name`. Rendering
 * those crashed the page ("Objects are not valid as a React child").
 * Normalise every entry to a plain display string, merge duplicates, and
 * title-case the lowercase pipeline names.
 */
export function normalizeAuthors(raw: unknown): Author[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, number>();
  for (const entry of raw) {
    const e = entry as { name?: unknown; article_count?: unknown };
    const rawName =
      typeof e.name === "string" ? e.name : (e.name as { name?: unknown } | null)?.name;
    if (typeof rawName !== "string" || rawName.trim().length === 0) continue;
    const name = rawName
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    const count = typeof e.article_count === "number" ? e.article_count : 0;
    merged.set(name, (merged.get(name) ?? 0) + count);
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, article_count]) => ({ id: name, name, article_count }));
}

interface InsightsClientProps {
  /** Data prefetched by the server page — null members mean that fetch failed. */
  initialStats?: Stats | null;
  initialTrending?: TrendingCategory[] | null;
  /** Raw trending_authors payload (normalised client-side). */
  initialAuthors?: unknown[] | null;
}

export default function InsightsClient({
  initialStats = null,
  initialTrending = null,
  initialAuthors = null,
}: InsightsClientProps) {
  const hasInitialData =
    initialStats !== null || initialTrending !== null || initialAuthors !== null;

  const [loading, setLoading] = useState(!hasInitialData);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [trending, setTrending] = useState<TrendingCategory[]>(initialTrending ?? []);
  const [authors, setAuthors] = useState<Author[]>(normalizeAuthors(initialAuthors ?? []));

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      getStatsAction(),
      getTrendingCategoriesAction(8),
      getTrendingAuthorsAction(5),
    ]);

    if (results[0].status === "fulfilled" && results[0].value.database) {
      setStats(results[0].value.database);
    }
    if (results[1].status === "fulfilled") {
      setTrending(results[1].value as TrendingCategory[]);
    }
    if (results[2].status === "fulfilled" && results[2].value.trending_authors) {
      setAuthors(normalizeAuthors(results[2].value.trending_authors));
    }

    // Surface an explicit error (with retry) when nothing loaded, instead of
    // silently rendering the "No data available" empty state.
    if (results.every((r) => r.status === "rejected")) {
      const reason = (results[0] as PromiseRejectedResult).reason;
      console.error("Failed to load insights:", reason);
      setError(reason instanceof Error ? reason.message : "Failed to load insights");
    }
    setLoading(false);
  }, []);

  // Fetch on mount only when the server page couldn't provide initial data.
  useEffect(() => {
    if (!hasInitialData) {
      loadData();
    }
  }, [hasInitialData, loadData]);

  if (loading) {
    return <InsightsPageSkeleton />;
  }

  if (error) {
    return (
      <div
        className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <WifiOff className="w-12 h-12 text-text-tertiary mb-4" aria-hidden="true" />
        <p className="text-lg text-text-secondary mb-2">Unable to load insights</p>
        <p className="text-sm text-text-tertiary mb-6 max-w-md">{error}</p>
        <button
          onClick={() => loadData()}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-full font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="p-8 text-center text-text-secondary">Failed to render insights</div>
      }
    >
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">Insights</h1>
          </div>
          <p className="text-text-secondary">
            Analytics and trending topics across African news
          </p>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-surface rounded-2xl p-6 text-center border border-elevated">
              <Newspaper className="w-8 h-8 text-primary mx-auto mb-3" />
              <div className="text-3xl font-bold text-foreground mb-1">
                {stats.total_articles.toLocaleString()}
              </div>
              <div className="text-sm text-text-secondary">Articles</div>
            </div>
            <div className="bg-surface rounded-2xl p-6 text-center border border-elevated">
              <Users className="w-8 h-8 text-primary mx-auto mb-3" />
              <div className="text-3xl font-bold text-foreground mb-1">
                {stats.active_sources}
              </div>
              <div className="text-sm text-text-secondary">Sources</div>
            </div>
            <div className="bg-surface rounded-2xl p-6 text-center border border-elevated">
              <Layers className="w-8 h-8 text-primary mx-auto mb-3" />
              <div className="text-3xl font-bold text-foreground mb-1">
                {stats.categories > 0 ? stats.categories : trending.length}
              </div>
              <div className="text-sm text-text-secondary">Topics</div>
            </div>
          </div>
        )}

        {/* Trending Topics */}
        {trending.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <span>🔥</span> Trending Now
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {trending.map((topic, i) => (
                <Link
                  key={topic.id}
                  href={`/discover?category=${topic.id}`}
                  className="bg-surface rounded-xl p-4 border border-elevated hover:border-primary/50 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-2xl">{getEmoji(topic.name)}</span>
                    {i < 3 && (
                      <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground mb-1 truncate">
                    {topic.name}
                  </h3>
                  <p className="text-xs text-text-secondary">
                    {topic.article_count} articles
                  </p>
                  {topic.growth_rate && topic.growth_rate > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-green-600">
                      <TrendingUp className="w-3 h-3" />
                      <span className="text-xs font-medium">
                        +{Math.round(topic.growth_rate)}%
                      </span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Top Journalists */}
        {authors.length > 0 && (
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <span>✍️</span> Top Journalists
            </h2>
            <div className="bg-surface rounded-xl border border-elevated divide-y divide-elevated">
              {authors.map((author, i) => (
                <Link
                  key={author.id}
                  href={`/search?q=${encodeURIComponent(author.name)}`}
                  className="flex items-center p-4 hover:bg-elevated/50 transition-colors"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center mr-4 font-bold text-sm ${
                      i === 0
                        ? "bg-accent text-on-accent"
                        : i === 1
                          ? "bg-elevated text-foreground"
                          : i === 2
                            ? "bg-warning text-on-warning"
                            : "bg-surface text-foreground"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground">{author.name}</h3>
                    <p className="text-xs text-text-secondary">
                      {author.article_count} articles
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-text-tertiary" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {!stats && trending.length === 0 && authors.length === 0 && (
          <div className="text-center py-16">
            <span className="text-6xl mb-4 block">📊</span>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No data available
            </h3>
            <p className="text-text-secondary">
              Check back later for insights and analytics
            </p>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
