"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, ArrowRight, Newspaper, RefreshCw, WifiOff } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DiscoverPageSkeleton } from "@/components/ui/discover-skeleton";
import { type Article, type Category } from "@/lib/api";
import { getArticlesAction, getCategoriesAction, getSourcesAction } from "@/lib/actions/feed";
import { categoryTone } from "@/lib/category-tone";
import { useCoverage } from "@/contexts/coverage-context";
import {
  COUNTRIES,
  CATEGORY_META,
  getFullUrl,
  COUNTRY_SCOPE_TOTAL,
} from "@/lib/constants";
import { WebPageJsonLd } from "@/components/ui/json-ld";

interface Source {
  id: string;
  name: string;
  url?: string;
  category?: string;
  country_id?: string;
  article_count?: number;
  latest_article_at?: string;
}

interface Keyword {
  id: string;
  name: string;
  slug: string;
  type: string;
  article_count: number;
}

interface DiscoverClientProps {
  /** Unfiltered article list prefetched by the server page (null if that fetch failed). */
  initialArticles?: Article[] | null;
  /** Category list prefetched by the server page (null if that fetch failed). */
  initialCategories?: Category[] | null;
  /** Source list prefetched by the server page (null if that fetch failed). */
  initialSources?: Source[] | null;
}

export default function DiscoverClient({
  initialArticles = null,
  initialCategories = null,
  initialSources = null,
}: DiscoverClientProps) {
  // One shared figure: the page description, the "coming soon" test and the
  // country grid must all agree, and they only can if they read the same value.
  const coverage = useCoverage();
  const liveCodes = useMemo(() => new Set(coverage.codes), [coverage.codes]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>(initialArticles ?? []);
  const [categories, setCategories] = useState<Category[]>(
    (initialCategories ?? []).filter((c) => c.id !== "all")
  );
  const [sources, setSources] = useState<Source[]>(initialSources ?? []);
  const [keywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(!initialArticles);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Check for active filters from URL
  const activeCategory = searchParams.get("category");
  const activeCountry = searchParams.get("country");
  const activeSource = searchParams.get("source");

  // Tracks whether the category/source metadata has been loaded (either
  // provided by the server page or fetched once client-side).
  const metadataLoadedRef = useRef(Boolean(initialCategories && initialSources));

  const fetchData = useCallback(
    async (category: string | null, country: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const promises: Promise<unknown>[] = [
          getArticlesAction({
            limit: 50,
            category: category || undefined,
            countries: country ? [country] : undefined,
          }),
        ];

        // Fetch metadata only on first load
        if (!metadataLoadedRef.current) {
          promises.push(getCategoriesAction(), getSourcesAction());
        }

        const results = await Promise.all(promises);

        const articlesRes = results[0] as { articles?: Article[] };
        setArticles(articlesRes.articles || []);

        if (!metadataLoadedRef.current) {
          const categoriesRes = results[1] as Category[];
          const sourcesRes = results[2] as Source[];
          setCategories((categoriesRes || []).filter((c) => c.id !== "all"));
          setSources(sourcesRes || []);
          metadataLoadedRef.current = true;
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
        setError(err instanceof Error ? err.message : "Failed to load discover data");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // True until the first fetch effect run has decided whether the
  // server-provided data can stand in for the initial client fetch.
  const skipInitialFetchRef = useRef(Boolean(initialArticles));

  // Fetch articles when filters change. The very first run is skipped when the
  // server already provided the unfiltered default view and no URL filters are
  // active.
  useEffect(() => {
    if (skipInitialFetchRef.current && !activeCategory && !activeCountry) {
      skipInitialFetchRef.current = false;
      return;
    }
    skipInitialFetchRef.current = false;
    fetchData(activeCategory, activeCountry);
  }, [activeCategory, activeCountry, fetchData]);

  // Client-side filter for source and search (server doesn't support these yet)
  const filteredArticles = useMemo(() => {
    return articles.filter((a) => {
      if (activeSource && a.source !== activeSource) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          a.title.toLowerCase().includes(query) ||
          a.description?.toLowerCase().includes(query) ||
          a.source?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [articles, activeSource, searchQuery]);

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const isFiltered = activeCategory || activeCountry || activeSource;

  // A country that is in scope but not released yet. Its page is honest about
  // that rather than rendering an empty result set, which reads to a reader as
  // "we lost the articles" and to a crawler as a soft-404.
  const countryComingSoon = !!activeCountry && !liveCodes.has(activeCountry);

  if (loading) {
    return <DiscoverPageSkeleton />;
  }

  if (error) {
    return (
      <div
        className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <WifiOff className="w-12 h-12 text-text-tertiary mb-4" aria-hidden="true" />
        <p className="text-lg text-text-secondary mb-2">Unable to load Discover</p>
        <p className="text-sm text-text-tertiary mb-6 max-w-md">{error}</p>
        <button
          onClick={() => fetchData(activeCategory, activeCountry)}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-full font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary fallback={<div className="p-8 text-center text-text-secondary">Failed to load discover page</div>}>
      <WebPageJsonLd
        name="Discover — Mukoko News"
        description={`Explore African news by category, country and trending topics. Browse sources and discover stories — ${coverage.fragment}.`}
        url={getFullUrl("/discover")}
      />
      <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-8">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-foreground mb-2">Discover</h1>
        <p className="text-text-secondary">
          Explore news from across Africa, browse by category, or check out stories from your favorite sources.
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="relative mb-12">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search articles, topics, or sources..."
          className="w-full pl-12 pr-4 py-4 bg-surface rounded-2xl border border-elevated outline-none text-foreground placeholder:text-text-tertiary focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
        />
      </form>

      {/* Show filtered results if filters are active */}
      {isFiltered ? (
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {[
                  activeCategory && categories.find(c => c.id === activeCategory)?.name,
                  activeCountry && COUNTRIES.find(c => c.code === activeCountry)?.name,
                  activeSource,
                ].filter(Boolean).join(" · ")}
              </h2>
              <p className="text-text-secondary text-sm mt-1">
                {countryComingSoon
                  ? "Coming soon — no sources here yet"
                  : `${filteredArticles.length} articles found`}
              </p>
            </div>
            <Link
              href="/discover"
              className="text-sm text-primary font-medium hover:underline"
            >
              Clear filters
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredArticles.map((article, index) => (
              <ArticleCard key={article.id} article={article} index={index} />
            ))}
          </div>
          {filteredArticles.length === 0 && (
            <div className="text-center py-12">
              {/* An in-scope country we have not launched yet says so. It used to
                  render "No articles found", which reads as a temporary blank —
                  and, submitted in the sitemap, as a soft-404. */}
              {countryComingSoon ? (
                <>
                  <p className="text-foreground font-medium">
                    {COUNTRIES.find((c) => c.code === activeCountry)?.name} is coming soon
                  </p>
                  <p className="text-text-secondary text-sm mt-2 max-w-md mx-auto">
                    Mukoko News is live in {coverage.count} African countries today, with
                    all {coverage.scopeTotal} African Union member states in scope. We have not
                    onboarded a newsroom here yet.
                  </p>
                  <Link
                    href="/discover"
                    className="inline-block mt-6 text-sm text-primary font-medium hover:underline"
                  >
                    Browse the countries we cover
                  </Link>
                </>
              ) : (
                <p className="text-text-secondary">No articles found for this filter.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Latest News Section */}
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-foreground">Latest News</h2>
                <p className="text-text-secondary text-sm mt-0.5">Pan-African</p>
              </div>
              <Link
                href="/"
                className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground transition-colors"
              >
                View All <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {articles.slice(0, 6).map((article, index) => (
                <ArticleCard key={article.id} article={article} index={index} />
              ))}
            </div>
          </section>

          {/* Trending Topics - Tag Cloud */}
          {keywords.length > 0 && (
            <KeywordCloud keywords={keywords} />
          )}

          {/* Browse by Category */}
          <section className="mb-12">
            <h2 className="text-xl font-bold text-foreground mb-6">Browse by Category</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {categories.map((category) => {
                const meta = CATEGORY_META[category.id];
                return (
                  <Link
                    key={category.id}
                    href={`/discover?category=${category.id}`}
                    className="flex items-center gap-3 p-4 bg-surface rounded-xl border border-elevated hover:border-primary/30 hover:bg-elevated transition-all group"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${categoryTone(category.id)}`}
                    >
                      {meta?.emoji ?? "📰"}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate group-hover:underline decoration-2 underline-offset-2">
                        {category.name}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {category.article_count || 0} Articles
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Browse by Country */}
          <section className="mb-12">
            <h2 className="text-xl font-bold text-foreground mb-6">Browse by Country</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {COUNTRIES.map((country) => {
                const articleCount = articles.filter(a => (a.country_id || a.country) === country.code).length;
                const released = liveCodes.has(country.code);
                return (
                  <Link
                    key={country.code}
                    href={`/discover?country=${country.code}`}
                    className="flex items-center gap-3 p-4 bg-surface rounded-xl border border-elevated hover:border-primary/30 hover:bg-elevated transition-all group"
                  >
                    {/* Neutral, not a per-country hue: the flag is the
                        country's identity and the circle is just the shape it
                        sits in. See the note on `COUNTRIES` in constants.ts. */}
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-lg">
                      {country.flag}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate group-hover:underline decoration-2 underline-offset-2">
                        {country.name}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {articleCount > 0
                          ? `${articleCount} Articles`
                          : released
                            ? "Browse news"
                            : "Coming soon"}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Browse by Source — only show sources with articles, sorted by count */}
          <SourcesSection sources={sources} />
        </>
      )}
      </div>
    </ErrorBoundary>
  );
}

function SourcesSection({ sources }: { sources: Source[] }) {
  const activeSources = useMemo(() => {
    return sources
      .filter((s) => (s.article_count || 0) > 0)
      .sort((a, b) => (b.article_count || 0) - (a.article_count || 0));
  }, [sources]);

  if (activeSources.length === 0) return null;

  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-foreground">Browse by Source</h2>
        <Link
          href="/sources"
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground transition-colors"
        >
          View All <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {activeSources.slice(0, 12).map((source) => {
          const country = COUNTRIES.find(c => c.code === source.country_id);
          return (
            <Link
              key={source.id}
              href={`/discover?source=${encodeURIComponent(source.name)}`}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl border border-elevated hover:border-primary/30 hover:bg-elevated transition-all group"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Newspaper className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate group-hover:underline decoration-2 underline-offset-2">
                  {source.name}
                </p>
                <p className="text-xs text-text-tertiary">
                  {country ? `${country.flag} ` : ""}{(source.article_count || 0).toLocaleString()} articles
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// Extracted component — uses logarithmic scaling so outliers don't dominate
function KeywordCloud({ keywords }: { keywords: Keyword[] }) {
  const { logMin, logRange } = useMemo(() => {
    const counts = keywords.map((k) => k.article_count);
    const min = Math.log1p(Math.min(...counts));
    const max = Math.log1p(Math.max(...counts));
    return { logMin: min, logRange: max - min || 1 };
  }, [keywords]);

  return (
    <section className="mb-12">
      <h2 className="text-xl font-bold text-foreground mb-6">Trending Topics</h2>
      <div className="flex flex-wrap items-center gap-2">
        {keywords.map((keyword) => {
          // Logarithmic normalization: prevents high-count outliers from dwarfing everything
          const normalized = (Math.log1p(keyword.article_count) - logMin) / logRange;
          const fontSize = 0.8 + normalized * 0.9; // 0.8rem to 1.7rem
          const fontWeight = normalized > 0.6 ? 600 : normalized > 0.3 ? 500 : 400;

          return (
            <Link
              key={keyword.id}
              href={`/search?q=${encodeURIComponent(keyword.name)}`}
              className="inline-block bg-surface rounded-full border border-elevated hover:border-primary/30 hover:bg-elevated transition-all text-foreground hover:text-primary whitespace-nowrap"
              style={{
                fontSize: `${fontSize}rem`,
                fontWeight,
                padding: `${0.25 + normalized * 0.15}em ${0.55 + normalized * 0.25}em`,
              }}
            >
              {keyword.name}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
