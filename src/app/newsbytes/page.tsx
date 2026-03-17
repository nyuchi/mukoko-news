// MIGRATION NOTE: This consumer-facing page is migrating to the Mukoko super app (app.mukoko.com).
// This repo (mukoko-news) is becoming the news platform layer.
// See CLAUDE.md "Consumer → Super App Migration" section.
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Heart,
  Share2,
  Bookmark,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { api, type Article } from "@/lib/api";
import { isValidImageUrl, safeCssUrl } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { NewsBytesSkeleton } from "@/components/ui/discover-skeleton";

export default function NewsBytesPage() {
  const router = useRouter();
  const [bytes, setBytes] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [bytesState, setBytesState] = useState<Record<string, { isLiked: boolean; isSaved: boolean; likesCount: number }>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Force refresh - reloads the page and clears cache
  const handleForceRefresh = () => {
    router.refresh();
    loadNewsBytes();
  };

  useEffect(() => {
    loadNewsBytes();
  }, []);

  const loadNewsBytes = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.getNewsBytes({ limit: 50 });
      const articles = data.articles || [];

      // Filter to only articles with valid image URLs
      const withImages = articles.filter((a) => isValidImageUrl(a.image));

      const initialState: Record<string, { isLiked: boolean; isSaved: boolean; likesCount: number }> = {};
      withImages.forEach((byte) => {
        initialState[byte.id] = {
          isLiked: byte.isLiked || false,
          isSaved: byte.isSaved || false,
          likesCount: byte.like_count || 0,
        };
      });

      setBytesState(initialState);
      setBytes(withImages.slice(0, 20));
    } catch (err) {
      console.error("Failed to load NewsBytes:", err);
      setError("Failed to load NewsBytes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Track which item is in view using IntersectionObserver
  // Depends on bytes.length (not bytes reference) to avoid unnecessary observer re-creation
  useEffect(() => {
    if (bytes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = itemRefs.current.findIndex((ref) => ref === entry.target);
            if (index !== -1) {
              setCurrentIndex(index);
            }
          }
        });
      },
      {
        root: containerRef.current,
        threshold: 0.6, // Item is "current" when 60% visible
      }
    );

    itemRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [bytes.length]);

  const handleLike = async (byteId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistic update
    setBytesState((prev) => {
      const current = prev[byteId] || { isLiked: false, isSaved: false, likesCount: 0 };
      return {
        ...prev,
        [byteId]: {
          ...current,
          isLiked: !current.isLiked,
          likesCount: current.isLiked ? current.likesCount - 1 : current.likesCount + 1,
        },
      };
    });

    // Call API
    try {
      await api.likeArticle(byteId);
    } catch (err) {
      // Revert on error
      console.error("Failed to like article:", err);
      setBytesState((prev) => {
        const current = prev[byteId] || { isLiked: false, isSaved: false, likesCount: 0 };
        return {
          ...prev,
          [byteId]: {
            ...current,
            isLiked: !current.isLiked,
            likesCount: current.isLiked ? current.likesCount + 1 : current.likesCount - 1,
          },
        };
      });
    }
  };

  const handleSave = async (byteId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Optimistic update
    setBytesState((prev) => {
      const current = prev[byteId] || { isLiked: false, isSaved: false, likesCount: 0 };
      return {
        ...prev,
        [byteId]: {
          ...current,
          isSaved: !current.isSaved,
        },
      };
    });

    // Call API
    try {
      await api.saveArticle(byteId);
    } catch (err) {
      // Revert on error
      console.error("Failed to save article:", err);
      setBytesState((prev) => {
        const current = prev[byteId] || { isLiked: false, isSaved: false, likesCount: 0 };
        return {
          ...prev,
          [byteId]: {
            ...current,
            isSaved: !current.isSaved,
          },
        };
      });
    }
  };

  const handleShare = async (byte: Article, e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({
          title: byte.headline,
          text: byte.description || byte.headline,
          url: `/article/${byte.id}`,
        });
      } catch (err) {
        console.log("Share cancelled");
      }
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "Recently";
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "Recently";
    }
  };

  const setItemRef = useCallback((el: HTMLDivElement | null, index: number) => {
    itemRefs.current[index] = el;
  }, []);

  if (loading) {
    return <NewsBytesSkeleton />;
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black">
        <div className="relative h-full w-full md:w-auto md:h-[calc(100vh-80px)] md:aspect-[9/16] md:max-h-[900px] md:rounded-2xl md:overflow-hidden md:shadow-2xl md:shadow-black/50 bg-black flex items-end justify-center px-6 pb-32">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 text-primary mx-auto mb-4" />
            <h2 className="font-serif text-xl font-bold text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-white/60 mb-6">{error}</p>
            <button
              onClick={handleForceRefresh}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (bytes.length === 0) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black">
        <div className="relative h-full w-full md:w-auto md:h-[calc(100vh-80px)] md:aspect-[9/16] md:max-h-[900px] md:rounded-2xl md:overflow-hidden md:shadow-2xl md:shadow-black/50 bg-black flex items-end justify-center px-6 pb-32">
          <div className="text-center">
            <p className="text-6xl mb-4">📰</p>
            <h2 className="font-serif text-xl font-bold text-white mb-2">
              No NewsBytes available
            </h2>
            <p className="text-white/60">Check back later for more stories</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary fallback={<div className="fixed inset-0 z-40 flex items-center justify-center bg-black text-white/60">Failed to load NewsBytes</div>}>
      <div className="fixed inset-0 z-40 bg-black flex items-center justify-center">
        {/* Desktop/Tablet: Centered vertical frame container */}
      <div className="relative h-full w-full md:w-auto md:h-[calc(100vh-80px)] md:aspect-[9/16] md:max-h-[900px] md:rounded-2xl md:overflow-hidden md:shadow-2xl md:shadow-black/50">
        {/* Progress Indicator - positioned below header */}
        <div className="absolute top-16 sm:top-20 md:top-4 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-1">
          {bytes.slice(0, 10).map((_, index) => (
            <div
              key={index}
              className={`h-1 rounded-full transition-all ${
                index === currentIndex
                  ? "w-6 bg-primary"
                  : "w-1 bg-white/40"
              }`}
            />
          ))}
          {bytes.length > 10 && (
            <span className="text-white/60 text-xs ml-1">+{bytes.length - 10}</span>
          )}
        </div>

        {/* TikTok-style scrollable container */}
        <div
          ref={containerRef}
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide bg-black"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
        {bytes.map((byte, index) => {
          const byteState = bytesState[byte.id] || { isLiked: false, isSaved: false, likesCount: 0 };

          return (
            <div
              key={byte.id}
              ref={(el) => setItemRef(el, index)}
              className="relative w-full h-full snap-start snap-always"
              style={{
                backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.3), rgba(0,0,0,0.7)), ${safeCssUrl(byte.image ?? "")}`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              {/* Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/90" />

              {/* Content */}
              <div className="absolute bottom-0 left-4 right-16 sm:left-6 sm:right-20 z-10 pb-6">
                {/* Category Badge */}
                {(byte.article_section_id) && (
                  <span className="inline-block px-3 py-1 bg-primary text-black text-xs font-bold uppercase rounded-lg mb-3">
                    {byte.article_section_id}
                  </span>
                )}

                {/* Title */}
                <h1 className="font-serif text-xl sm:text-2xl md:text-3xl font-bold text-white mb-3 leading-tight">
                  {byte.headline}
                </h1>

                {/* Description */}
                {byte.description && (
                  <p className="text-white/80 text-sm mb-4 line-clamp-2">
                    {byte.description.slice(0, 150)}...
                  </p>
                )}

                {/* Source & Date */}
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <span className="font-bold text-primary">{byte.publisher_name}</span>
                  <span>•</span>
                  <span>{formatDate(byte.date_published)}</span>
                </div>

                {/* Read More Button */}
                <Link
                  href={`/article/${byte.id}`}
                  className="inline-block mt-4 px-5 py-2.5 bg-black/40 backdrop-blur-md border border-white/20 text-white font-medium rounded-xl hover:bg-black/50 transition-colors"
                >
                  Read Full Article
                </Link>
              </div>

              {/* Right Side Actions */}
              <div className="absolute right-3 sm:right-4 bottom-6 z-10 flex flex-col items-center gap-4 sm:gap-5">
                <button
                  onClick={(e) => handleLike(byte.id, e)}
                  className="flex flex-col items-center"
                  aria-label={byteState.isLiked ? "Unlike article" : "Like article"}
                  aria-pressed={byteState.isLiked}
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-full">
                    <Heart
                      className={`w-5 h-5 sm:w-6 sm:h-6 ${
                        byteState.isLiked ? "fill-red-500 text-red-500" : "text-white"
                      }`}
                    />
                  </div>
                  <span className="text-white text-xs mt-1">
                    {byteState.likesCount}
                  </span>
                </button>

                <button
                  onClick={(e) => handleShare(byte, e)}
                  className="flex flex-col items-center"
                  aria-label="Share article"
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-full">
                    <Share2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <span className="text-white text-xs mt-1">Share</span>
                </button>

                <button
                  onClick={(e) => handleSave(byte.id, e)}
                  className="flex flex-col items-center"
                  aria-label={byteState.isSaved ? "Remove from saved" : "Save article"}
                  aria-pressed={byteState.isSaved}
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-full">
                    <Bookmark
                      className={`w-5 h-5 sm:w-6 sm:h-6 ${
                        byteState.isSaved ? "fill-primary text-primary" : "text-white"
                      }`}
                    />
                  </div>
                </button>
              </div>
            </div>
          );
        })}
        </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
