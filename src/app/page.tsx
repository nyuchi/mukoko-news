"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, ChevronRight, Compass, RefreshCw, WifiOff, TrendingUp, Newspaper } from "lucide-react";
import { CategoryChip } from "@/components/ui/category-chip";
import { ArticleCard } from "@/components/article-card";
import { HeroCard } from "@/components/hero-card";
import { CompactCard } from "@/components/compact-card";
import { StoryCluster, StoryClusterCompact } from "@/components/story-cluster";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { FeedPageSkeleton } from "@/components/ui/skeleton";
import { CollectionPageJsonLd, ItemListJsonLd } from "@/components/ui/json-ld";
import { usePreferences } from "@/contexts/preferences-context";
import { api, type Article, type StoryCluster as StoryClusterType, type CategorySection } from "@/lib/api";
import { isValidImageUrl } from "@/lib/utils";
import { BASE_URL } from "@/lib/constants";
import { triggerFeedCollection } from "@/lib/actions/refresh";

// Redesigned layout - Top Stories, Your News, By Category, Latest

export default function FeedPage() {
  const { selectedCategories, selectedCountries } = usePreferences();

  // Sectioned feed state
  const [topStories, setTopStories] = useState<StoryClusterType[]>([]);
  const [yourNews, setYourNews] = useState<Article[]>([]);
  const [byCategory, setByCategory] = useState<CategorySection[]>([]);
  const [latestArticles, setLatestArticles] = useState<Article[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSticky, setIsSticky] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const filtersSectionRef = useRef<HTMLDivElement>(null);
  const topStoriesScrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const lastRefreshTimeRef = useRef(0);

  // Stable sorted country key - prevents unnecessary refetch when countries are reordered
  const countryKey = useMemo(
    () => selectedCountries.slice().sort().join(","),
    [selectedCountries]
  );

  // Stable sorted category key
  const categoryKey = useMemo(
    () => selectedCategories.slice().sort().join(","),
    [selectedCategories]
  );

  // Fetch sectioned feed
  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const countries = countryKey ? countryKey.split(",") : [];
      const categories = categoryKey ? categoryKey.split(",") : [];

      const response = await api.getSectionedFeed({
        countries: countries.length > 0 ? countries : undefined,
        categories: categories.length > 0 ? categories : undefined,
      });

      setTopStories(response.topStories || []);
      setYourNews(response.yourNews || []);
      setByCategory(response.byCategory || []);
      setLatestArticles(response.latest || []);
    } catch (err) {
      console.error("Failed to fetch feed:", err);
      setError(err instanceof Error ? err.message : "Failed to load news feed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [countryKey, categoryKey]);

  // Ref to always hold the latest handleRefresh
  const handleRefreshRef = useRef(() => {});

  // Refresh handler
  const handleRefresh = useCallback(() => {
    if (!refreshing && !loading) {
      void triggerFeedCollection();
      fetchData(true);
    }
  }, [refreshing, loading, fetchData]);

  // Keep ref in sync
  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  }, [handleRefresh]);

  // Fetch data when preferences change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Pull-to-refresh for mobile
  useEffect(() => {
    // Track mount status for cleanup safety
    isMountedRef.current = true;
    let currentPullDistance = 0;
    const DEBOUNCE_MS = 2000; // 2 second debounce between refreshes

    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || window.scrollY > 0) {
        currentPullDistance = 0;
        setPullDistance(0);
        return;
      }
      const touchY = e.touches[0].clientY;
      const distance = Math.max(0, (touchY - touchStartY.current) * 0.5);
      if (distance > 0 && distance < 150) {
        currentPullDistance = distance;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
        rafIdRef.current = requestAnimationFrame(() => {
          if (isMountedRef.current) {
            setPullDistance(distance);
          }
        });
      }
    };

    const handleTouchEnd = () => {
      const now = Date.now();
      // Guard: only refresh if mounted and debounce period has passed
      if (
        currentPullDistance > 80 &&
        isMountedRef.current &&
        now - lastRefreshTimeRef.current > DEBOUNCE_MS
      ) {
        lastRefreshTimeRef.current = now;
        handleRefreshRef.current();
      }
      currentPullDistance = 0;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        if (isMountedRef.current) {
          setPullDistance(0);
        }
      });
      isPulling.current = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      isMountedRef.current = false;
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Sticky header on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (filtersSectionRef.current) {
        const rect = filtersSectionRef.current.getBoundingClientRect();
        setIsSticky(rect.top <= 72);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTopStories = (direction: "left" | "right") => {
    if (topStoriesScrollRef.current) {
      topStoriesScrollRef.current.scrollBy({
        left: direction === "left" ? -300 : 300,
        behavior: "smooth",
      });
    }
  };

  const hasContent = topStories.length > 0 || yourNews.length > 0 || byCategory.length > 0 || latestArticles.length > 0;

  // Extract primary articles from story clusters for schema.org
  const topStoriesArticles = useMemo(
    () => topStories.map((cluster) => cluster.primaryArticle),
    [topStories]
  );

  return (
    <>
      {/* Schema.org structured data for SEO */}
      <CollectionPageJsonLd
        name="For You - Mukoko News"
        description="Pan-African news feed with top stories, personalized news, and the latest articles from across Africa."
        url={BASE_URL}
        articles={[...topStoriesArticles, ...latestArticles].slice(0, 10)}
      />
      {topStoriesArticles.length > 0 && (
        <ItemListJsonLd
          articles={topStoriesArticles}
          name="Top Stories"
          description="Trending news stories from across Africa"
        />
      )}
      {latestArticles.length > 0 && (
        <ItemListJsonLd
          articles={latestArticles}
          name="Latest News"
          description="Most recent news articles from Pan-African sources"
        />
      )}

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
      {/* Pull-to-refresh indicator (mobile) */}
      {pullDistance > 0 && (
        <div
          className="fixed top-[72px] left-0 right-0 flex justify-center z-50 md:hidden"
          style={{ transform: `translateY(${Math.min(pullDistance, 80)}px)` }}
          aria-hidden="true"
        >
          <div className={`bg-primary/10 rounded-full p-2 ${pullDistance > 80 ? "animate-pulse" : ""}`}>
            <RefreshCw
              className={`w-5 h-5 text-primary ${refreshing ? "animate-spin" : ""}`}
              style={{ transform: `rotate(${pullDistance * 2}deg)` }}
            />
          </div>
        </div>
      )}

      {/* Refreshing indicator */}
      {refreshing && (
        <div className="fixed top-[80px] left-0 right-0 flex justify-center z-50" role="status" aria-live="polite">
          <div className="bg-primary text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 shadow-lg">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Refreshing...
          </div>
        </div>
      )}

      {/* Feed Header */}
      <header className="py-5 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-xl">For You</h1>
          <p className="text-xs text-text-tertiary">Pan-African News</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button (tablet/desktop) */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-surface rounded-full text-sm font-medium hover:bg-elevated transition-colors disabled:opacity-50"
            aria-label="Refresh news feed"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            <span className="hidden lg:inline">Refresh</span>
          </button>

          <Link
            href="/discover"
            className="flex items-center gap-2 px-4 py-2 bg-surface rounded-full text-sm font-medium hover:bg-elevated transition-colors"
          >
            <Compass className="w-4 h-4" aria-hidden="true" />
            Discover
          </Link>
        </div>
      </header>

      {/* Quick Category Pills */}
      <div ref={filtersSectionRef}>
        <nav
          aria-label="Quick navigation"
          className={`py-3 border-b border-elevated transition-all duration-300 ${
            isSticky
              ? "fixed top-[72px] left-0 right-0 z-40 bg-background/80 backdrop-blur-xl shadow-sm"
              : ""
          }`}
        >
          <div className={isSticky ? "max-w-[1200px] mx-auto px-4 sm:px-6" : ""}>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              <CategoryChip label="Top Stories" active icon={<TrendingUp className="w-3.5 h-3.5" />} onClick={() => document.getElementById('top-stories')?.scrollIntoView({ behavior: 'smooth' })} />
              {selectedCategories.length > 0 && (
                <CategoryChip label="Your News" icon={<Newspaper className="w-3.5 h-3.5" />} onClick={() => document.getElementById('your-news')?.scrollIntoView({ behavior: 'smooth' })} />
              )}
              {byCategory.map((section) => (
                <CategoryChip
                  key={section.id}
                  label={section.name}
                  onClick={() => document.getElementById(`category-${section.id}`)?.scrollIntoView({ behavior: 'smooth' })}
                />
              ))}
            </div>
          </div>
        </nav>
        {isSticky && <div className="h-[52px]" />}
      </div>

      {/* Main Content */}
      <main>
        {loading ? (
          <FeedPageSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" role="alert">
            <WifiOff className="w-12 h-12 text-text-tertiary mb-4" aria-hidden="true" />
            <p className="text-lg text-text-secondary mb-2">Unable to load articles</p>
            <p className="text-sm text-text-tertiary mb-6 max-w-md">{error}</p>
            <button
              onClick={() => fetchData()}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-full font-medium hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try Again
            </button>
          </div>
        ) : hasContent ? (
          <div className="py-6 space-y-10">
            {/* TOP STORIES - Trending with story clustering */}
            {topStories.length > 0 && (
              <ErrorBoundary fallback={<div className="p-8 rounded-2xl bg-surface text-center text-text-secondary">Top stories unavailable</div>}>
                <section id="top-stories" aria-labelledby="top-stories-heading" className="scroll-mt-32">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
                      <h2 id="top-stories-heading" className="text-lg font-bold">Top Stories</h2>
                    </div>
                    <div className="hidden sm:flex items-center gap-1">
                      <button
                        onClick={() => scrollTopStories("left")}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface transition-colors"
                        aria-label="Scroll left"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => scrollTopStories("right")}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface transition-colors"
                        aria-label="Scroll right"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Featured top story (first cluster) */}
                  {topStories[0] && (
                    <div className="mb-4">
                      <StoryCluster cluster={topStories[0]} />
                    </div>
                  )}

                  {/* Horizontal scrolling for more top stories */}
                  {topStories.length > 1 && (
                    <div
                      ref={topStoriesScrollRef}
                      className="flex gap-4 overflow-x-auto scrollbar-hide pb-2"
                      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                    >
                      {topStories.slice(1).map((cluster) => (
                        <StoryClusterCompact key={cluster.id} cluster={cluster} />
                      ))}
                    </div>
                  )}
                </section>
              </ErrorBoundary>
            )}

            {/* YOUR NEWS - Based on preferred categories */}
            {yourNews.length > 0 && selectedCategories.length > 0 && (
              <ErrorBoundary fallback={<div className="p-4 rounded-lg bg-surface text-center text-text-secondary">Your news unavailable</div>}>
                <section id="your-news" aria-labelledby="your-news-heading" className="scroll-mt-32">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Newspaper className="w-5 h-5 text-secondary" aria-hidden="true" />
                      <h2 id="your-news-heading" className="text-lg font-bold">Your News</h2>
                    </div>
                    <span className="text-sm text-text-tertiary">
                      Based on your interests
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {yourNews.slice(0, 6).map((article) => (
                      <ArticleCard key={article.id} article={article} />
                    ))}
                  </div>
                </section>
              </ErrorBoundary>
            )}

            {/* BY CATEGORY - Sections for each preferred category */}
            {byCategory.map((section) => (
              <ErrorBoundary key={section.id} fallback={<div className="p-4 rounded-lg bg-surface text-center text-text-secondary">{section.name} unavailable</div>}>
                <section id={`category-${section.id}`} aria-labelledby={`category-${section.id}-heading`} className="scroll-mt-32">
                  <div className="flex items-center justify-between mb-4">
                    <h2 id={`category-${section.id}-heading`} className="text-lg font-bold">{section.name}</h2>
                    <Link
                      href={`/discover?category=${section.id}`}
                      className="text-sm text-primary font-medium hover:underline flex items-center gap-1"
                    >
                      See all
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>

                  {/* First article as hero, rest as compact cards */}
                  {section.articles.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Hero for first article if it has an image */}
                      {section.articles[0] && isValidImageUrl(section.articles[0].image_url) ? (
                        <div className="lg:col-span-2">
                          <HeroCard article={section.articles[0]} />
                        </div>
                      ) : (
                        <div className="lg:col-span-2">
                          <ArticleCard article={section.articles[0]} />
                        </div>
                      )}

                      {/* Compact cards for rest */}
                      <div className="space-y-3">
                        {section.articles.slice(1, 5).map((article) => (
                          <CompactCard key={article.id} article={article} />
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </ErrorBoundary>
            ))}

            {/* LATEST - All latest articles sorted by date */}
            {latestArticles.length > 0 && (
              <ErrorBoundary fallback={<div className="p-4 rounded-lg bg-surface text-center text-text-secondary">Latest articles unavailable</div>}>
                <section id="latest" aria-labelledby="latest-heading" className="scroll-mt-32">
                  <div className="flex items-center justify-between mb-4">
                    <h2 id="latest-heading" className="text-lg font-bold">Latest</h2>
                    <span className="text-sm text-text-tertiary">
                      {latestArticles.length} articles
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {latestArticles.map((article) => (
                      <ArticleCard key={article.id} article={article} />
                    ))}
                  </div>
                </section>
              </ErrorBoundary>
            )}
          </div>
        ) : (
          <div className="text-center py-16 text-text-secondary">
            <p className="text-lg">No articles found.</p>
            <Link
              href="/discover"
              className="mt-4 inline-block text-primary font-medium hover:underline"
            >
              Explore categories
            </Link>
          </div>
        )}
      </main>
    </div>
    </>
  );
}
