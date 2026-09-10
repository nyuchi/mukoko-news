"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { type Category } from "@/lib/api";
import { getCategoriesAction } from "@/lib/actions/feed";
import { categoryTone } from "@/lib/category-tone";

/**
 * Emoji only. The colour comes from `categoryTone`, which is shared with every
 * other surface that draws a category — this file used to keep a private table
 * of twelve `from-<hue>-500 to-<hue>-700` gradients that disagreed with
 * `CATEGORY_META` in `constants.ts` about which categories even exist.
 */
const categoryEmoji: Record<string, string> = {
  politics: "\u{1F3DB}\u{FE0F}",
  business: "\u{1F4BC}",
  sports: "\u26BD",
  entertainment: "\u{1F3AC}",
  technology: "\u{1F4BB}",
  health: "\u{1F3E5}",
  education: "\u{1F4DA}",
  world: "\u{1F30D}",
  local: "\u{1F4CD}",
  opinion: "\u{1F4AD}",
  lifestyle: "\u2728",
  science: "\u{1F52C}",
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const cats = await getCategoriesAction();
      setCategories(cats);
    } catch (error) {
      console.error("Failed to load categories:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[var(--width-wide)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-8">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold mb-2">Categories</h1>
        <p className="text-text-secondary">
          Browse news by topic
        </p>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category) => {
          const categoryKey = category.id?.toLowerCase() || category.name.toLowerCase();
          const emoji = categoryEmoji[categoryKey] ?? "\u{1F4F0}";

          return (
            <Link
              key={category.id}
              href={`/discover?category=${encodeURIComponent(category.id)}`}
              className="group"
            >
              {/* A flat mineral container, not a gradient. Mzizi takes no
                  gradients, and the pair carries its own foreground so the card
                  is legible in both themes without a hard-coded `text-white`. */}
              <div
                className={`relative overflow-hidden rounded-2xl p-6 transition-transform hover:-translate-y-1 hover:shadow-xl ${categoryTone(category.id)}`}
              >
                {/* Emoji Background */}
                <div className="absolute -right-4 -bottom-4 text-8xl opacity-20 select-none">
                  {emoji}
                </div>

                {/* Content */}
                <div className="relative z-10">
                  <span className="text-4xl mb-3 block">{emoji}</span>
                  <h3 className="font-bold text-xl mb-1">{category.name}</h3>
                  {category.article_count !== undefined && (
                    <p className="text-sm opacity-75">
                      {category.article_count.toLocaleString()} articles
                    </p>
                  )}
                </div>

                {/* Arrow */}
                <div className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Empty State */}
      {categories.length === 0 && (
        <div className="text-center py-20">
          <p className="text-6xl mb-4">📂</p>
          <h2 className="font-serif text-xl font-bold mb-2">No categories found</h2>
          <p className="text-text-secondary">
            Check back later for organized news topics.
          </p>
        </div>
      )}
    </div>
  );
}
