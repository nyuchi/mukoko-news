// MIGRATION NOTE: This consumer-facing page is migrating to the Mukoko super app (app.mukoko.com).
// This repo (mukoko-news) is becoming the news platform layer.
// See CLAUDE.md "Consumer → Super App Migration" section.
"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, ArrowRight, Newspaper } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DiscoverPageSkeleton } from "@/components/ui/discover-skeleton";
import { api, type Article, type Category } from "@/lib/api";
import { COUNTRIES, SECTION_META, getFullUrl } from "@/lib/constants";
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

export default function DiscoverPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Check for active filters from URL
  const activeCategory = searchParams.get("category");
  const activeCountry = searchParams.get("country");
  const activeSource = searchParams.get("source");

  const [metadataLoaded, setMetadataLoaded] = useState(false);

  // Fetch articles (re-runs when filters change) and metadata (once on mount)
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const promises: Promise<unknown>[] = [
          api.getArticles({
            limit: 50,
            category: activeCategory || undefined,
            country: activeCountry || undefined,
          }),
        ];

        // Fetch metadata only on first load
        if (!metadataLoaded) {
          promises.push(
            api.getCategories(),
            api.getSources(),
            api.getKeywords(32),
          );
        }

        const results = await Promise.all(promises);

        const articlesRes = results[0] as { articles?: Article[] };
        setArticles(articlesRes.articles || []);

        if (!metadataLoaded) {
          const categoriesRes = results[1] as { categories?: Category[] };
          const sourcesRes = results[2] as { sources?: Source[] };
          const keywordsRes = results[3] as { keywords?: Keyword[] };
          setCategories(categoriesRes.categories?.filter((c) => c.id !== "all") || []);
          setSources(sourcesRes.sources || []);
          setKeywords(keywordsRes.keywords || []);
          setMetadataLoaded(true);
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  // metadataLoaded is intentionally excluded — it only gates the initial metadata fetch
  // and must not trigger a re-run when it flips to true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, activeCountry]);

  // Client-side filter for source and search (server doesn't support these yet)
  const filteredArticles = useMemo(() => {
    return articles.filter((a) => {
      if (activeSource && a.publisher_name !== activeSource) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          a.headline.toLowerCase().includes(query) ||
          a.description?.toLowerCase().includes(query) ||
          a.publisher_name?.toLowerCase().includes(query)
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

  if (loading) {
    return <DiscoverPageSkeleton />;
  }

  return (
    <ErrorBoundary fallback={<div className="p-8 text-center text-text-secondary">Failed to load discover page</div>}>
      <WebPageJsonLd
        name="Discover — Mukoko News"
        description="Explore African news by category, country, and trending topics. Browse sources and discover stories from 16 African countries."
        url={getFullUrl("/discover")}
      />
      <div className="max-w-[1200px] mx-auto px-6 py-8">
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
                {filteredArticles.length} articles found
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
            {filteredArticles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
          {filteredArticles.length === 0 && (
            <div className="text-center py-12">
              <p className="text-text-secondary">No articles found for this filter.</p>
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
              {articles.slice(0, 6).map((article) => (
                <ArticleCard key={article.id} article={article} />
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
                const meta = SECTION_META[category.id] || { emoji: "📰", color: "bg-gray-500" };
                return (
                  <Link
                    key={category.id}
                    href={`/discover?category=${category.id}`}
                    className="flex items-center gap-3 p-4 bg-surface rounded-xl border border-elevated hover:border-primary/30 hover:bg-elevated transition-all group"
                  >
                    <div className={`w-10 h-10 rounded-full ${meta.color} flex items-center justify-center text-lg`}>
                      {meta.emoji}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
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
                const articleCount = articles.filter(a => a.about_country_id === country.code).length;
                return (
                  <Link
                    key={country.code}
                    href={`/discover?country=${country.code}`}
                    className="flex items-center gap-3 p-4 bg-surface rounded-xl border border-elevated hover:border-primary/30 hover:bg-elevated transition-all group"
                  >
                    <div className={`w-10 h-10 rounded-full ${country.color} flex items-center justify-center text-lg`}>
                      {country.flag}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {country.name}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {articleCount > 0 ? `${articleCount} Articles` : "Browse news"}
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
                <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
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
