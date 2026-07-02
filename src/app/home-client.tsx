"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { type Article, type Category, type StoryCluster as StoryClusterType, type CategorySection } from "@/lib/api";
import { getSectionedFeedAction, getArticlesAction, getCategoriesAction, type SectionedFeed } from "@/lib/actions/feed";
import { isValidImageUrl } from "@/lib/utils";
import { BASE_URL, DEFAULT_FEED_COUNTRIES } from "@/lib/constants";
import { triggerFeedCollection } from "@/lib/actions/refresh";

// How many articles each "Latest" page fetches — must match the server action's latest limit.
const LATEST_PAGE_SIZE = 20;

// Preference keys the server page fetched the initial feed with. When the
// user's (post-hydration) preferences still match these defaults, the initial
// client fetch is skipped and the server-provided feed is used as-is.
const DEFAULT_COUNTRY_KEY = DEFAULT_FEED_COUNTRIES.slice().sort().join(",");
const DEFAULT_CATEGORY_KEY = "";

interface HomeClientProps {
  /** Feed prefetched by the server page with the default preferences (null if the server fetch failed). */
  initialFeed?: SectionedFeed | null;
  /** Category list prefetched by the server page (null if the server fetch failed). */
  initialCategories?: Category[] | null;
}

// Redesigned layout - Top Stories, Your News, By Category, Latest

export default function HomeClient({ initialFeed = null, initialCategories = null }: HomeClientProps) {
  const router = useRouter();
  const { selectedCategories, selectedCountries } = usePreferences();

  // Sectioned feed state — seeded from the server-rendered initial feed so the
  // first paint already has content instead of an empty shell.
  const [topStories, setTopStories] = useState<StoryClusterType[]>(initialFeed?.topStories ?? []);
  const [yourNews, setYourNews] = useState<Article[]>(initialFeed?.yourNews ?? []);
  const [byCategory, setByCategory] = useState<CategorySection[]>(initialFeed?.byCategory ?? []);
  const [latestArticles, setLatestArticles] = useState<Article[]>(initialFeed?.latest ?? []);

  // Full category list for the quick-nav bar (independent of what's in the latest feed)
  const [allCategories, setAllCategories] = useState<Category[]>(
    (initialCategories ?? []).filter((c) => c.id !== "all")
  );

  // Infinite scroll for the chronological "Latest" feed
  const [latestPage, setLatestPage] = useState(1);
  const [hasMoreLatest, setHasMoreLatest] = useState(
    !initialFeed || (initialFeed.latest?.length ?? 0) >= LATEST_PAGE_SIZE
  );
  const [loadingMore, setLoadingMore] = useState(false);

  // Measured height of the global sticky header, so the category bar sits flush
  // beneath it instead of using a brittle hardcoded offset.
  const [headerOffset, setHeaderOffset] = useState(64);

  const [loading, setLoading] = useState(!initialFeed);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const topStoriesScrollRef = useRef<HTMLDivElement>(null);
  const latestSentinelRef = useRef<HTMLDivElement>(null);
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

      const response = await getSectionedFeedAction({
        countries: countries.length > 0 ? countries : undefined,
        categories: categories.length > 0 ? categories : undefined,
      });

      const latest = response.latest || [];
      setTopStories(response.topStories || []);
      setYourNews(response.yourNews || []);
      setByCategory(response.byCategory || []);
      setLatestArticles(latest);
      // Reset infinite-scroll pagination for the new filter set
      setLatestPage(1);
      setHasMoreLatest(latest.length >= LATEST_PAGE_SIZE);
    } catch (err) {
      console.error("Failed to fetch feed:", err);
      setError(err instanceof Error ? err.message : "Failed to load news feed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [countryKey, categoryKey]);

  // Track the global header's height (it changes between breakpoints and scroll states)
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-app-header]");
    if (!header) return;
    const update = () => setHeaderOffset(header.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Load the full category list once for the quick-nav bar (skipped when the
  // server page already provided it)
  useEffect(() => {
    if (initialCategories) return;
    let cancelled = false;
    getCategoriesAction()
      .then((categories) => {
        if (!cancelled) setAllCategories((categories || []).filter((c) => c.id !== "all"));
      })
      .catch((err) => console.error("Failed to fetch categories:", err));
    return () => {
      cancelled = true;
    };
  }, [initialCategories]);

  // Load the next page of the chronological "Latest" feed (sorted by timestamp,
  // across all sources — never grouped by source).
  const loadMoreLatest = useCallback(async () => {
    if (loadingMore || !hasMoreLatest) return;
    setLoadingMore(true);
    try {
      const nextPage = latestPage + 1;
      const countries = countryKey ? countryKey.split(",") : [];
      const { articles, total } = await getArticlesAction({
        sort: "latest",
        page: nextPage,
        limit: LATEST_PAGE_SIZE,
        countries: countries.length > 0 ? countries : undefined,
      });
      setLatestArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...articles.filter((a) => !seen.has(a.id))];
      });
      setLatestPage(nextPage);
      setHasMoreLatest(articles.length >= LATEST_PAGE_SIZE && nextPage * LATEST_PAGE_SIZE < total);
    } catch (err) {
      console.error("Failed to load more articles:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreLatest, latestPage, countryKey]);

  // Keep a stable ref to the latest loader so the observer never re-registers
  const loadMoreLatestRef = useRef(loadMoreLatest);
  useEffect(() => {
    loadMoreLatestRef.current = loadMoreLatest;
  }, [loadMoreLatest]);

  // IntersectionObserver sentinel — fetches the next page as it nears the viewport
  useEffect(() => {
    const sentinel = latestSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreLatestRef.current();
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, error]);

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

  // True until the first fetch effect run has decided whether the
  // server-provided feed can stand in for the initial client fetch.
  const skipInitialFetchRef = useRef(Boolean(initialFeed));

  // Fetch data when preferences change. The very first run is skipped when the
  // server already rendered the feed for the same (default) preferences —
  // refetch only when the user's stored preferences differ or they change filters.
  useEffect(() => {
    if (
      skipInitialFetchRef.current &&
      countryKey === DEFAULT_COUNTRY_KEY &&
      categoryKey === DEFAULT_CATEGORY_KEY
    ) {
      skipInitialFetchRef.current = false;
      return;
    }
    skipInitialFetchRef.current = false;
    fetchData();
  }, [fetchData, countryKey, categoryKey]);

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
          <div className="bg-primary text-on-primary px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 shadow-lg">
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

      {/* Quick Category Pills — sticks flush beneath the measured global header height */}
      <nav
        aria-label="Quick navigation"
        className="sticky z-40 py-3 border-b border-elevated bg-background/80 backdrop-blur-xl"
        style={{ top: headerOffset }}
      >
        <div className="flex gap-2 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <CategoryChip label="Top Stories" active icon={<TrendingUp className="w-3.5 h-3.5" />} onClick={() => document.getElementById('top-stories')?.scrollIntoView({ behavior: 'smooth' })} />
          {selectedCategories.length > 0 && (
            <CategoryChip label="Your News" icon={<Newspaper className="w-3.5 h-3.5" />} onClick={() => document.getElementById('your-news')?.scrollIntoView({ behavior: 'smooth' })} />
          )}
          {allCategories.map((category) => {
            // Scroll to the on-page section if this category is present in the feed;
            // otherwise open the full category view in Discover.
            const section = byCategory.find((s) => s.id === category.id || s.name === category.name);
            return (
              <CategoryChip
                key={category.id}
                label={category.name}
                onClick={() =>
                  section
                    ? document.getElementById(`category-${section.id}`)?.scrollIntoView({ behavior: 'smooth' })
                    : router.push(`/discover?category=${category.id}`)
                }
              />
            );
          })}
        </div>
      </nav>

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
              className="flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-full font-medium hover:opacity-90 transition-opacity"
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
                    {yourNews.slice(0, 6).map((article, index) => (
                      <ArticleCard key={article.id} article={article} index={index} />
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
                        {section.articles.slice(1, 5).map((article, index) => (
                          <CompactCard key={article.id} article={article} index={index} />
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
                    {latestArticles.map((article, index) => (
                      <ArticleCard key={article.id} article={article} index={index} />
                    ))}
                  </div>

                  {/* Infinite scroll: sentinel triggers the next chronological page */}
                  {hasMoreLatest && (
                    <div ref={latestSentinelRef} className="flex justify-center py-8" aria-hidden="true">
                      {loadingMore && (
                        <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
                      )}
                    </div>
                  )}
                  {!hasMoreLatest && latestArticles.length > LATEST_PAGE_SIZE && (
                    <p className="text-center text-sm text-text-tertiary py-8" role="status">
                      You&apos;re all caught up
                    </p>
                  )}
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
