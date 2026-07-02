"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Bookmark, Loader2, RefreshCw } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { type Article } from "@/lib/api";
import { getSavedArticlesAction } from "@/lib/actions/feed";

function SavedContent() {
  const [savedArticles, setSavedArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSavedArticles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getSavedArticlesAction();
      setSavedArticles(data.articles || []);
    } catch (err) {
      console.error("Failed to load saved articles:", err);
      setError("Failed to load saved articles");
      setSavedArticles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSavedArticles();
  }, [loadSavedArticles]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold mb-2">Saved Articles</h1>
        <p className="text-text-secondary">
          Articles you&apos;ve bookmarked for later reading
        </p>
      </div>

      {savedArticles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {savedArticles.map((article, index) => (
            <ArticleCard key={article.id} article={article} index={index} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6">
            <Bookmark className="w-10 h-10 text-text-tertiary" />
          </div>
          <h2 className="font-serif text-xl font-bold mb-2">No saved articles</h2>
          <p className="text-text-secondary mb-6 max-w-md mx-auto">
            When you find articles you want to read later, tap the bookmark icon
            to save them here.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
          >
            Discover Articles
          </Link>
        </div>
      )}
    </div>
  );
}

export default function SavedPage() {
  return (
    <ErrorBoundary
      fallback={
        <div className="max-w-[1200px] mx-auto px-6 py-8 text-center">
          <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6">
            <Bookmark className="w-10 h-10 text-text-tertiary" />
          </div>
          <h2 className="font-serif text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-text-secondary mb-4">
            We couldn&apos;t load your saved articles. Please try refreshing the page.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
          >
            Back to Home
          </Link>
        </div>
      }
    >
      <SavedContent />
    </ErrorBoundary>
  );
}
