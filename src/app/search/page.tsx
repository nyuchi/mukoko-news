"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Search, Loader2, TrendingUp, BarChart3, X } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { Button } from "@/components/ui/button";
import { CategoryChip } from "@/components/ui/category-chip";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { type Article, type Category } from "@/lib/api";
import { getCategoriesAction, getTrendingCategoriesAction, getStatsAction, searchArticlesAction } from "@/lib/actions/feed";
import { useMeter } from "@/hooks/use-meter";
import { MeterWall } from "@/components/access/meter-wall";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [searchMethod, setSearchMethod] = useState<'semantic' | 'keyword' | null>(null);

  // Searching is metered for readers without an account (5, see @/lib/access).
  const searchMeter = useMeter("searches");
  const [walled, setWalled] = useState(false);

  // ⚠️ A search is a QUERY, not a request.
  //
  // `performSearch` is called from four places and two of them re-run the query
  // already on screen with a different category filter. Counting every call
  // would spend a reader's whole allowance on one question — five chip taps
  // while refining a single search and they are done — which is not what
  // anybody reads "5 searches" to mean. So the allowance is spent when the
  // query TEXT changes, and narrowing what you already asked is free.
  const spentOnRef = useRef<string | null>(null);

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
      setWalled(false);
      return;
    }

    const term = searchQuery.trim();
    if (spentOnRef.current !== term) {
      if (!searchMeter.allowed) {
        // Out of allowance. Show the wall over the reader's own query rather
        // than running it — and do NOT clear what is already on screen, so the
        // last search they did get stays readable behind the ask.
        setActiveQuery(term);
        setWalled(true);
        return;
      }
      searchMeter.record();
      spentOnRef.current = term;
    }
    setWalled(false);

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
  }, [searchMeter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query, selectedCategory);
  };

  const handleClear = () => {
    setQuery("");
    setActiveQuery("");
    setResults([]);
    setSelectedCategory(null);
    setWalled(false);
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
      <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block)]">
        {/* Search Bar */}
      <div className="mb-8">
        <form onSubmit={handleSearch} className="relative">
          <div className="flex items-center gap-2 sm:gap-3 bg-surface border border-control rounded-2xl pl-4 pr-2 py-2 focus-within:border-primary transition-colors">
            <Search className="w-5 h-5 shrink-0 text-text-tertiary" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search African news..."
              aria-label="Search African news"
              className="min-w-0 flex-1 bg-transparent outline-none text-foreground placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                className="shrink-0 p-1 hover:bg-elevated rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-text-tertiary" />
              </button>
            )}
            {/*
              The form's only control used to be the text input, so there was
              nothing to press: submission relied entirely on the browser's
              implicit-submit-on-Enter, which is invisible on desktop and is the
              one affordance a reader never discovers. The handler was always
              correct — the button is what makes it reachable.
            */}
            <Button
              type="submit"
              size="sm"
              disabled={!query.trim() || loading}
              className="shrink-0"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="w-4 h-4" aria-hidden="true" />
              )}
              {/*
                One label, not a visible copy plus a screen-reader copy — two
                would concatenate into the accessible name "Search Search".
                `sr-only sm:not-sr-only` keeps the button icon-only on a narrow
                phone while still naming it.
              */}
              <span className="sr-only sm:not-sr-only">Search</span>
            </Button>
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

      {/* Out of free searches.
          This block comes BEFORE the results block and that block is now
          guarded on `!walled`, because the results header reads "Found N
          results for X" — and with the search never run, N is 0. Rendering it
          would tell the reader this corpus holds nothing on their subject,
          which is a claim about the corpus we did not measure. Exactly the
          failure `CorpusSummary.ok` exists to prevent, one surface over. */}
      {isSearchMode && walled && (
        <div className="mb-8">
          <MeterWall
            title="That's your free searches on this device"
            had={`You've run ${searchMeter.used} searches here without an account. We haven't run this one.`}
            promise="A free account makes search unlimited, and keeps your saved articles with the account instead of this browser."
            returnTo={`/search`}
          />
        </div>
      )}

      {/* Search Results */}
      {isSearchMode && !loading && !walled && (
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
              {results.map((article, index) => (
                <ArticleCard key={article.id} article={article} index={index} />
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
                  className="px-4 py-2 bg-surface border border-outline rounded-full text-sm hover:border-primary hover:text-primary transition-colors"
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
            <div className="bg-surface border border-outline rounded-2xl overflow-hidden">
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
            <div className="bg-surface border border-outline rounded-2xl p-6">
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
