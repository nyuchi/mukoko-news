"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Clock } from "lucide-react";
import type { Article } from "@/lib/api";
import { formatTimeAgo, isValidImageUrl } from "@/lib/utils";
import { SourceIcon } from "@/components/ui/source-icon";

interface HeroCardProps {
  article: Article;
}

export function HeroCard({ article }: HeroCardProps) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [article.id]);

  const hasImage = isValidImageUrl(article.image) && !imageError;
  const timeAgo = formatTimeAgo(article.date_published);
  const category = article.article_section_id;

  return (
    <Link
      href={`/article/${article.id}`}
      className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-2xl"
      aria-label={`Read article: ${article.headline}`}
    >
      <article className="relative rounded-2xl overflow-hidden bg-surface border border-border">
        {/* Image area with gradient overlay */}
        <div className="relative h-[280px] sm:h-[340px] md:h-[400px] w-full">
          {/* Background - either image or gradient fallback */}
          {hasImage && article.image ? (
            <>
              <Image
                src={article.image}
                alt={article.description || article.headline || "Article image"}
                fill
                className="object-cover"
                onError={() => setImageError(true)}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 100vw, 1200px"
                priority
              />
              {/* Gradient overlay for text readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" aria-hidden="true" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary" aria-hidden="true" />
          )}

          {/* Category badge */}
          {category && (
            <span className="absolute top-4 left-4 bg-primary text-white px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide z-10">
              {category}
            </span>
          )}

          {/* Content overlay at bottom */}
          <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6 z-10">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-white mb-3 leading-tight group-hover:text-primary transition-colors line-clamp-3">
              {article.headline}
            </h2>

            {article.description && (
              <p className="text-white/70 text-sm sm:text-base line-clamp-2 mb-4 max-w-2xl">
                {article.description}
              </p>
            )}

            <div className="flex items-center gap-4 text-white/60">
              <div className="flex items-center gap-1.5">
                <SourceIcon source={article.publisher_name ?? ''} size={20} showBorder={false} />
                <span className="text-sm text-white/80">{article.publisher_name}</span>
              </div>
              <time className="flex items-center gap-1.5 text-sm" dateTime={article.date_published}>
                <Clock className="w-4 h-4" aria-hidden="true" />
                <span>{timeAgo}</span>
              </time>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
