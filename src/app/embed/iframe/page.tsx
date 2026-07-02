"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, ExternalLink, Clock, MapPin, TrendingUp, Sparkles, Newspaper } from "lucide-react";
import { type Article } from "@/lib/api";
import { getArticlesAction } from "@/lib/actions/feed";
import { getArticleUrl, BASE_URL, COUNTRIES } from "@/lib/constants";
import { isValidImageUrl, formatTimeAgo, safeCssUrl } from "@/lib/utils";
import { imageProxyUrl } from "@/lib/image";
import { SourceIcon } from "@/components/ui/source-icon";

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

type FeedType = "top" | "featured" | "latest" | "location";
type LayoutType = "cards" | "compact" | "hero" | "ticker" | "list";

const FEED_META: Record<FeedType, { label: string; icon: typeof TrendingUp }> = {
  top: { label: "Top Stories", icon: TrendingUp },
  featured: { label: "Featured", icon: Sparkles },
  latest: { label: "Latest News", icon: Newspaper },
  location: { label: "Local News", icon: MapPin },
};

const DEFAULT_LIMITS: Record<LayoutType, number> = {
  cards: 6,
  compact: 8,
  hero: 1,
  ticker: 10,
  list: 10,
};

// ---------------------------------------------------------------------------
// Card Variants
// ---------------------------------------------------------------------------

function HeroEmbed({ article }: { article: Article }) {
  const timeAgo = formatTimeAgo(article.published_at);
  const category = article.category_id || article.category;
  const articleUrl = getArticleUrl(article.id);
  const hasImage = isValidImageUrl(article.image_url);

  return (
    <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="block group">
      <article className="relative rounded-2xl overflow-hidden" style={{ minHeight: 280 }}>
        {hasImage ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: safeCssUrl(imageProxyUrl(article.image_url!, { width: 600 })) }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

        <div className="relative flex flex-col justify-end h-full p-5" style={{ minHeight: 280 }}>
          {category && (
            <span className="self-start bg-black/70 text-white backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2">
              {category}
            </span>
          )}
          <h3 className="text-lg font-bold text-white leading-snug line-clamp-3 group-hover:underline decoration-2 underline-offset-2">
            {article.title}
          </h3>
          {article.description && (
            <p className="text-white/70 text-xs line-clamp-2 mt-1.5">{article.description}</p>
          )}
          <div className="flex items-center gap-3 mt-3 text-white/60 text-[11px]">
            <div className="flex items-center gap-1.5">
              <SourceIcon source={article.source} size={14} showBorder={false} />
              <span>{article.source}</span>
            </div>
            <time className="flex items-center gap-1" dateTime={article.published_at}>
              <Clock className="w-3 h-3" />
              {timeAgo}
            </time>
          </div>
        </div>
      </article>
    </a>
  );
}

function CardEmbed({ article }: { article: Article }) {
  const timeAgo = formatTimeAgo(article.published_at);
  const category = article.category_id || article.category;
  const articleUrl = getArticleUrl(article.id);
  const hasImage = isValidImageUrl(article.image_url);

  return (
    <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="block group">
      <article className="rounded-xl overflow-hidden bg-surface border border-border hover:border-primary/40 transition-all hover:-translate-y-0.5 hover:shadow-lg">
        {hasImage && (
          <div
            className="h-[120px] bg-elevated bg-cover bg-center"
            style={{ backgroundImage: safeCssUrl(imageProxyUrl(article.image_url!, { width: 600 })) }}
          />
        )}
        <div className="p-3">
          {category && (
            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
              {category}
            </span>
          )}
          <h3 className="text-sm font-semibold leading-snug line-clamp-2 mt-0.5 group-hover:underline decoration-2 underline-offset-2">
            {article.title}
          </h3>
          <div className="flex items-center gap-2 mt-2 text-text-tertiary">
            <SourceIcon source={article.source} size={12} showBorder={false} />
            <span className="text-[11px] truncate">{article.source}</span>
            <time className="flex items-center gap-0.5 text-[11px] shrink-0 ml-auto" dateTime={article.published_at}>
              <Clock className="w-2.5 h-2.5" />
              {timeAgo}
            </time>
          </div>
        </div>
      </article>
    </a>
  );
}

function CompactEmbed({ article }: { article: Article }) {
  const timeAgo = formatTimeAgo(article.published_at);
  const category = article.category_id || article.category;
  const articleUrl = getArticleUrl(article.id);

  return (
    <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="block group">
      <article className="flex items-start gap-3 p-3 rounded-xl hover:bg-elevated transition-colors border border-transparent hover:border-primary/30">
        {/* Rank indicator */}
        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
          <SourceIcon source={article.source} size={14} showBorder={false} />
        </div>
        <div className="flex-1 min-w-0">
          {category && (
            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
              {category}
            </span>
          )}
          <h3 className="text-sm font-semibold leading-snug line-clamp-2 group-hover:underline decoration-2 underline-offset-2">
            {article.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 text-text-tertiary text-[11px]">
            <span className="truncate">{article.source}</span>
            <time className="flex items-center gap-0.5 shrink-0" dateTime={article.published_at}>
              <Clock className="w-2.5 h-2.5" />
              {timeAgo}
            </time>
          </div>
        </div>
        <ExternalLink className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
      </article>
    </a>
  );
}

function ListEmbed({ article }: { article: Article }) {
  const timeAgo = formatTimeAgo(article.published_at);
  const category = article.category_id || article.category;
  const articleUrl = getArticleUrl(article.id);
  const hasImage = isValidImageUrl(article.image_url);

  return (
    <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="block group">
      <article className="flex gap-3 p-3 rounded-xl hover:bg-elevated transition-colors border border-transparent hover:border-primary/30">
        {hasImage && (
          <div
            className="w-20 h-20 rounded-lg bg-elevated bg-cover bg-center shrink-0"
            style={{ backgroundImage: safeCssUrl(imageProxyUrl(article.image_url!, { width: 600 })) }}
          />
        )}
        <div className="flex-1 min-w-0">
          {category && (
            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
              {category}
            </span>
          )}
          <h3 className="text-sm font-semibold leading-snug line-clamp-2 group-hover:underline decoration-2 underline-offset-2">
            {article.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 text-text-tertiary">
            <SourceIcon source={article.source} size={12} showBorder={false} />
            <span className="text-[11px] truncate">{article.source}</span>
            <time className="flex items-center gap-0.5 text-[11px] shrink-0" dateTime={article.published_at}>
              <Clock className="w-2.5 h-2.5" />
              {timeAgo}
            </time>
          </div>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
      </article>
    </a>
  );
}

function TickerEmbed({ articles }: { articles: Article[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto px-3 py-2 scrollbar-hide">
      {articles.map((article) => {
        const articleUrl = getArticleUrl(article.id);
        const category = article.category_id || article.category;
        const hasImage = isValidImageUrl(article.image_url);

        return (
          <a
            key={article.id}
            href={articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block group shrink-0"
            style={{ width: 200 }}
          >
            <article className="rounded-xl overflow-hidden bg-surface border border-border hover:border-primary/40 transition-all hover:-translate-y-0.5 hover:shadow-lg h-full">
              {hasImage && (
                <div
                  className="h-[100px] bg-elevated bg-cover bg-center"
                  style={{ backgroundImage: safeCssUrl(imageProxyUrl(article.image_url!, { width: 600 })) }}
                />
              )}
              <div className="p-2.5">
                {category && (
                  <span className="text-[9px] font-bold text-primary uppercase tracking-wider">
                    {category}
                  </span>
                )}
                <h3 className="text-xs font-semibold leading-snug line-clamp-2 mt-0.5 group-hover:underline decoration-2 underline-offset-2">
                  {article.title}
                </h3>
                <span className="text-[10px] text-text-tertiary mt-1 block truncate">
                  {article.source}
                </span>
              </div>
            </article>
          </a>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton Loaders
// ---------------------------------------------------------------------------

function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl overflow-hidden bg-surface border border-border animate-pulse">
          <div className="h-[120px] bg-elevated" />
          <div className="p-3 space-y-2">
            <div className="h-2 w-12 bg-elevated rounded" />
            <div className="h-3.5 w-full bg-elevated rounded" />
            <div className="h-3.5 w-3/4 bg-elevated rounded" />
            <div className="flex gap-2 mt-1">
              <div className="h-2.5 w-16 bg-elevated rounded" />
              <div className="h-2.5 w-12 bg-elevated rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-1 p-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3 p-3 animate-pulse">
          <div className="w-20 h-20 rounded-lg bg-elevated shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-2 w-12 bg-elevated rounded" />
            <div className="h-3.5 w-full bg-elevated rounded" />
            <div className="h-3.5 w-3/4 bg-elevated rounded" />
            <div className="flex gap-2 mt-1">
              <div className="h-2.5 w-16 bg-elevated rounded" />
              <div className="h-2.5 w-12 bg-elevated rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="p-3" aria-hidden="true">
      <div className="rounded-2xl overflow-hidden animate-pulse" style={{ minHeight: 280 }}>
        <div className="bg-elevated h-[280px] flex flex-col justify-end p-5">
          <div className="h-4 w-16 bg-surface rounded-full mb-2" />
          <div className="h-5 w-full bg-surface rounded mb-1" />
          <div className="h-5 w-3/4 bg-surface rounded mb-2" />
          <div className="h-3 w-1/2 bg-surface rounded" />
        </div>
      </div>
    </div>
  );
}

function TickerSkeleton() {
  return (
    <div className="flex gap-3 px-3 py-2 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="shrink-0 rounded-xl overflow-hidden bg-surface border border-border animate-pulse" style={{ width: 200 }}>
          <div className="h-[100px] bg-elevated" />
          <div className="p-2.5 space-y-1.5">
            <div className="h-2 w-10 bg-elevated rounded" />
            <div className="h-3 w-full bg-elevated rounded" />
            <div className="h-2 w-14 bg-elevated rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Embed Page
// ---------------------------------------------------------------------------

export default function EmbedIframePage() {
  const searchParams = useSearchParams();

  // Parse URL parameters
  const country = searchParams.get("country")?.toUpperCase() || "ZW";
  const feedType = (searchParams.get("type") || "latest") as FeedType;
  const layout = (searchParams.get("layout") || "cards") as LayoutType;
  const category = searchParams.get("category") || undefined;
  const theme = searchParams.get("theme") || "auto";
  const limitParam = searchParams.get("limit");

  // Validate params
  const validFeedType: FeedType = ["top", "featured", "latest", "location"].includes(feedType) ? feedType : "latest";
  const validLayout: LayoutType = ["cards", "compact", "hero", "ticker", "list"].includes(layout) ? layout : "cards";
  const resolvedCountry = COUNTRIES.some((c) => c.code === country) ? country : "ZW";

  const parsedLimit = limitParam !== null ? parseInt(limitParam, 10) : NaN;
  const limit = !isNaN(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 20)
    : DEFAULT_LIMITS[validLayout];

  const countryInfo = useMemo(
    () => COUNTRIES.find((c) => c.code === resolvedCountry),
    [resolvedCountry]
  );

  const feedMeta = FEED_META[validFeedType];
  const FeedIcon = feedMeta.icon;

  // Determine header title based on feed type
  const headerTitle = useMemo(() => {
    if (validFeedType === "location") return `${countryInfo?.name || resolvedCountry} News`;
    return feedMeta.label;
  }, [validFeedType, countryInfo, resolvedCountry, feedMeta.label]);

  // Determine sort order based on feed type
  const sortOrder = useMemo((): "latest" | "trending" | "popular" => {
    switch (validFeedType) {
      case "top": return "trending";
      case "featured": return "popular";
      default: return "latest";
    }
  }, [validFeedType]);

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadArticles = useCallback(async () => {
    try {
      const data = await getArticlesAction({
        countries: [resolvedCountry],
        limit,
        sort: sortOrder === 'trending' ? 'popular' : sortOrder === 'popular' ? 'popular' : 'latest',
        category,
      });
      setArticles(data.articles || []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("[Embed] Failed to load articles:", err);
      setError("Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [resolvedCountry, limit, sortOrder, category]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  useEffect(() => {
    const interval = setInterval(loadArticles, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadArticles]);

  // Apply forced theme with cleanup to restore original state
  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      const hadLight = document.documentElement.classList.contains("light");
      const hadDark = document.documentElement.classList.contains("dark");
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);

      return () => {
        document.documentElement.classList.remove("light", "dark");
        if (hadLight) document.documentElement.classList.add("light");
        else if (hadDark) document.documentElement.classList.add("dark");
      };
    }
  }, [theme]);

  // Footer link
  const moreUrl = `${BASE_URL}/discover?country=${resolvedCountry}`;

  // Render articles based on layout
  const renderContent = () => {
    if (loading && articles.length === 0) {
      switch (validLayout) {
        case "hero": return <HeroSkeleton />;
        case "ticker": return <TickerSkeleton />;
        case "cards": return <CardsSkeleton count={limit} />;
        default: return <ListSkeleton count={limit} />;
      }
    }

    if (error && articles.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <p className="text-sm text-text-secondary mb-3">{error}</p>
          <button
            onClick={() => { setLoading(true); loadArticles(); }}
            className="text-xs px-3 py-1.5 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-opacity"
          >
            Try Again
          </button>
        </div>
      );
    }

    switch (validLayout) {
      case "hero":
        return articles[0] ? (
          <div className="p-3">
            <HeroEmbed article={articles[0]} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full p-6 text-center">
            <p className="text-sm text-text-tertiary">No stories available</p>
          </div>
        );

      case "cards":
        return (
          <div className="grid grid-cols-2 gap-3 p-3">
            {articles.map((article) => (
              <CardEmbed key={article.id} article={article} />
            ))}
          </div>
        );

      case "ticker":
        return articles.length > 0 ? (
          <TickerEmbed articles={articles} />
        ) : (
          <div className="flex items-center justify-center w-full p-4">
            <p className="text-sm text-text-tertiary">No stories available</p>
          </div>
        );

      case "compact":
        return (
          <div className="p-1">
            {articles.map((article) => (
              <CompactEmbed key={article.id} article={article} />
            ))}
          </div>
        );

      case "list":
      default:
        return (
          <div className="p-2 space-y-0.5">
            {articles.map((article) => (
              <ListEmbed key={article.id} article={article} />
            ))}
          </div>
        );
    }
  };

  // Ticker layout is a single horizontal strip — no header/footer chrome
  if (validLayout === "ticker") {
    return (
      <div className="fixed inset-0 z-[9999] bg-background flex flex-col overflow-hidden">
        {/* Minimal header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <a href={BASE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
            <img src="/mukoko-icon-dark.png" alt="Mukoko News" className="w-5 h-5 rounded" />
            <span className="text-xs font-bold">{headerTitle}</span>
            {countryInfo && (
              <span className="text-xs" aria-label={countryInfo.name}>{countryInfo.flag}</span>
            )}
          </a>
          <a
            href={moreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-text-tertiary hover:text-primary transition-colors flex items-center gap-0.5"
          >
            More <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
        <div className="flex-1 overflow-hidden flex items-center">
          {renderContent()}
        </div>
      </div>
    );
  }

  // Hero layout — single card, minimal chrome
  if (validLayout === "hero") {
    return (
      <div className="fixed inset-0 z-[9999] bg-background flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col justify-center">
          {renderContent()}
        </div>
        <footer className="flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-text-tertiary shrink-0">
          <a href={BASE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
            <img src="/mukoko-icon-dark.png" alt="Mukoko News" className="w-4 h-4 rounded" />
            <span className="font-semibold">Mukoko News</span>
            {countryInfo && <span aria-label={countryInfo.name}>{countryInfo.flag}</span>}
          </a>
          <a href={moreUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
            More stories <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </footer>
      </div>
    );
  }

  // Default full layout (cards, compact, list)
  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <a
          href={BASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <img src="/mukoko-icon-dark.png" alt="Mukoko News" className="w-6 h-6 rounded" />
          <div>
            <div className="flex items-center gap-1.5">
              <FeedIcon className="w-3.5 h-3.5 text-primary" />
              <h1 className="text-sm font-bold leading-none">{headerTitle}</h1>
              {countryInfo && (
                <span className="text-sm" aria-label={countryInfo.name}>{countryInfo.flag}</span>
              )}
            </div>
            <p className="text-[10px] text-text-tertiary leading-tight mt-0.5">
              Powered by Mukoko News
            </p>
          </div>
        </a>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-text-tertiary hidden sm:block">
              {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); loadArticles(); }}
            className="p-1.5 rounded-lg hover:bg-elevated transition-colors text-text-tertiary hover:text-foreground"
            aria-label="Refresh news"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">{renderContent()}</div>

      {/* Footer */}
      <footer className="flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-text-tertiary shrink-0">
        <span>
          {articles.length > 0 ? `${articles.length} stories` : "Loading..."}
        </span>
        <a
          href={moreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-primary transition-colors"
        >
          More on Mukoko News
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </footer>
    </div>
  );
}
