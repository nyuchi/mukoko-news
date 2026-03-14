"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import type { Article } from "@/lib/api";
import { formatTimeAgo } from "@/lib/utils";
import { SourceIcon } from "@/components/ui/source-icon";

interface CompactCardProps {
  article: Article;
}

export function CompactCard({ article }: CompactCardProps) {
  const timeAgo = formatTimeAgo(article.date_published);
  const category = article.article_section_id || article.category;

  return (
    <Link
      href={`/article/${article.id}`}
      className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
      aria-label={`Read article: ${article.headline}`}
    >
      <article className="p-4 rounded-xl bg-surface hover:bg-elevated transition-colors border border-border hover:border-primary/60">
        {/* Category */}
        {category && (
          <span className="text-xs font-semibold text-primary uppercase tracking-wide">
            {category}
          </span>
        )}

        {/* Title */}
        <h3 className="text-base font-semibold mt-1 mb-2 leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {article.headline}
        </h3>

        {/* Meta */}
        <div className="flex items-center gap-3 text-text-tertiary">
          <SourceIcon source={article.publisher_name} size={14} showBorder={false} />
          <span className="text-xs">{article.publisher_name}</span>
          <time className="flex items-center gap-1 text-xs" dateTime={article.date_published}>
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>{timeAgo}</span>
          </time>
        </div>
      </article>
    </Link>
  );
}
