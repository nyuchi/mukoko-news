"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TrendingUp, ChevronRight, Loader2, BarChart3, Users, Newspaper, Layers } from "lucide-react";
import { getStatsAction, getTrendingCategoriesAction, getTrendingAuthorsAction } from "@/lib/actions/feed";

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

interface Stats {
  total_articles: number;
  active_sources: number;
  categories: number;
}

interface TrendingCategory {
  id: string;
  name: string;
  slug: string;
  article_count: number;
  growth_rate?: number;
}

interface Author {
  id: string;
  name: string;
  article_count: number;
}

export default function InsightsPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trending, setTrending] = useState<TrendingCategory[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
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
        setAuthors(results[2].value.trending_authors);
      }
    } catch (err) {
      console.error("Failed to load insights:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
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
              {stats.categories}
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
                  className="w-8 h-8 rounded-full flex items-center justify-center mr-4 font-bold text-sm"
                  style={{
                    backgroundColor:
                      i === 0
                        ? "#FFD700"
                        : i === 1
                        ? "#C0C0C0"
                        : i === 2
                        ? "#CD7F32"
                        : "var(--surface)",
                    color: i < 3 ? "#fff" : "var(--foreground)",
                  }}
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
  );
}
