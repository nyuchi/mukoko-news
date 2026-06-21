"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Loader2, TrendingUp, BarChart3, X } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { CategoryChip } from "@/components/ui/category-chip";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { type Article, type Category } from "@/lib/api";
import { getCategoriesAction, getTrendingCategoriesAction, getStatsAction, searchArticlesAction } from "@/lib/actions/feed";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [searchMethod, setSearchMethod] = useState<'semantic' | 'keyword' | null>(null);

  // Real trending topics from categories
  const [trendingTopics, setTrendingTopics] = useState<Array<{ name: string; count: number }>>([]);

  // Real stats from API
  const [stats, setStats] = useState({
    totalArticles: 0,
    activeSources: 0,
    categories: 0,
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setInsightsLoading(true);
    try {
      const [cats, statsData, trending] = await Promise.all([
        getCategoriesAction().catch(() => [] as Category[]),
        getStatsAction().catch(() => ({ database: { total_articles: 0, active_sources: 0, categories: 0, today_articles: 0 } })),
        getTrendingCategoriesAction(6).catch(() => [] as Array<{ id: string; name: string; slug: string; article_count: number }>),
      ]);

      setCategories(cats);

      const db = statsData.database;
      setStats({
        totalArticles: db.total_articles || 0,
        activeSources: db.active_sources || 0,
        categories: db.categories || 0,
      });

      if (trending.length > 0) {
        setTrendingTopics(trending.map((t) => ({ name: t.name, count: t.article_count || 0 })));
      } else {
        setTrendingTopics(cats.slice(0, 6).map((c) => ({ name: c.name, count: c.article_count || 0 })));
      }
    } catch (error) {
      console.error("Failed to load initial data:", error);
    } finally {
      setInsightsLoading(false);
    }
  };

  const performSearch = useCallback(async (searchQuery: string, category?: string | null) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setActiveQuery("");
      setSearchMethod(null);
      return;
    }

    setLoading(true);
    setActiveQuery(searchQuery);

    try {
      const articles = await searchArticlesAction(searchQuery, 50, { category: category || undefined });
      setResults(articles);
      setSearchMethod('keyword');
    } catch (error) {
      console.error("Search error:", error);
      setResults([]);
      setSearchMethod(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query, selectedCategory);
  };

  const handleClear = () => {
    setQuery("");
    setActiveQuery("");
    setResults([]);
    setSelectedCategory(null);
  };

  const handleCategoryClick = (categoryName: string) => {
    if (selectedCategory === categoryName) {
      setSelectedCategory(null);
      if (activeQuery) performSearch(activeQuery, null);
    } else {
      setSelectedCategory(categoryName);
      if (activeQuery) performSearch(activeQuery, categoryName);
    }
  };

  const handleTrendingClick = (topic: string) => {
    setQuery(topic);
    performSearch(topic, selectedCategory);
  };

  const isSearchMode = activeQuery.length > 0;

  return (
    <ErrorBoundary fallback={<div className="p-8 text-center text-text-secondary">Failed to load search</div>}>
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {/* Search Bar */}
      <div className="mb-8">
        <form onSubmit={handleSearch} className="relative">
          <div className="flex items-center gap-3 bg-surface border border-elevated rounded-2xl px-4 py-3 focus-within:border-primary transition-colors">
            <Search className="w-5 h-5 text-text-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search African news..."
              className="flex-1 bg-transparent outline-none text-foreground placeholder:text-text-tertiary"
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 hover:bg-elevated rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-text-tertiary" />
              </button>
            )}
            {loading && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
          </div>
        </form>
      </div>

      {/* Category Filters - Only in search mode */}
      {isSearchMode && categories.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-6">
          {categories.slice(0, 8).map((category) => (
            <CategoryChip
              key={category.id}
              label={category.name}
              active={selectedCategory === category.name}
              onClick={() => handleCategoryClick(category.name)}
            />
          ))}
        </div>
      )}

      {/* Search Results */}
      {isSearchMode && !loading && (
        <>
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm text-text-secondary">
              Found {results.length} results for &quot;{activeQuery}&quot;
            </span>
            {searchMethod && (
              <span className={`text-xs px-2 py-1 rounded-full ${
                searchMethod === 'semantic'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-surface text-text-tertiary'
              }`}>
                {searchMethod === 'semantic' ? '✨ AI Search' : 'Keyword Search'}
              </span>
            )}
          </div>

          {results.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {results.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-6xl mb-4 opacity-50">📭</p>
              <h3 className="font-serif text-xl font-bold mb-2">No results found</h3>
              <p className="text-text-secondary mb-4">
                Try a different search term or category
              </p>
              <button
                onClick={handleClear}
                className="text-primary font-medium hover:underline"
              >
                Clear search
              </button>
            </div>
          )}
        </>
      )}

      {/* Insights Content - When not searching */}
      {!isSearchMode && !loading && (
        <>
          {/* AI Suggestions */}
          <div className="mb-10">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">
              Suggested Topics
            </h3>
            <div className="flex gap-2 flex-wrap">
              {categories.slice(0, 6).map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleTrendingClick(category.name)}
                  className="px-4 py-2 bg-surface border border-elevated rounded-full text-sm hover:border-primary hover:text-primary transition-colors"
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {/* Trending Searches */}
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Trending Searches
              </h3>
            </div>
            <div className="bg-surface border border-elevated rounded-2xl overflow-hidden">
              {trendingTopics.map((topic, index) => (
                <button
                  key={topic.name}
                  onClick={() => handleTrendingClick(topic.name)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-elevated transition-colors border-b border-elevated last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 flex items-center justify-center bg-primary/10 text-primary text-xs font-bold rounded-full">
                      {index + 1}
                    </span>
                    <span className="font-medium">{topic.name}</span>
                  </div>
                  <span className="text-sm text-text-tertiary">
                    {topic.count.toLocaleString()} articles
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Platform Stats */}
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-secondary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Platform Stats
              </h3>
            </div>
            <div className="bg-surface border border-elevated rounded-2xl p-6">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-3xl mb-1">📰</p>
                  <p className="text-2xl font-bold text-primary">
                    {stats.totalArticles.toLocaleString()}
                  </p>
                  <p className="text-xs text-text-tertiary">Articles</p>
                </div>
                <div className="border-x border-elevated">
                  <p className="text-3xl mb-1">📡</p>
                  <p className="text-2xl font-bold text-primary">
                    {stats.activeSources}
                  </p>
                  <p className="text-xs text-text-tertiary">Sources</p>
                </div>
                <div>
                  <p className="text-3xl mb-1">🗂️</p>
                  <p className="text-2xl font-bold text-primary">
                    {stats.categories}
                  </p>
                  <p className="text-xs text-text-tertiary">Topics</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </ErrorBoundary>
  );
}
