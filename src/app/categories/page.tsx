"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { type Category } from "@/lib/api";
import { getCategoriesAction } from "@/lib/actions/feed";

// Category colors and emojis
const categoryMeta: Record<string, { emoji: string; color: string }> = {
  politics: { emoji: "🏛️", color: "from-blue-500 to-blue-700" },
  business: { emoji: "💼", color: "from-emerald-500 to-emerald-700" },
  sports: { emoji: "⚽", color: "from-orange-500 to-orange-700" },
  entertainment: { emoji: "🎬", color: "from-purple-500 to-purple-700" },
  technology: { emoji: "💻", color: "from-cyan-500 to-cyan-700" },
  health: { emoji: "🏥", color: "from-red-500 to-red-700" },
  education: { emoji: "📚", color: "from-yellow-500 to-yellow-700" },
  world: { emoji: "🌍", color: "from-indigo-500 to-indigo-700" },
  local: { emoji: "📍", color: "from-pink-500 to-pink-700" },
  opinion: { emoji: "💭", color: "from-slate-500 to-slate-700" },
  lifestyle: { emoji: "✨", color: "from-rose-500 to-rose-700" },
  science: { emoji: "🔬", color: "from-teal-500 to-teal-700" },
};

const getDefaultMeta = (name: string) => ({
  emoji: "📰",
  color: "from-primary to-secondary",
});

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
    <div className="max-w-[1200px] mx-auto px-6 py-8">
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
          const meta = categoryMeta[categoryKey] || getDefaultMeta(category.name);

          return (
            <Link
              key={category.id}
              href={`/discover?category=${encodeURIComponent(category.id)}`}
              className="group"
            >
              <div
                className={`relative overflow-hidden rounded-2xl p-6 bg-gradient-to-br ${meta.color} text-white transition-transform hover:-translate-y-1 hover:shadow-xl`}
              >
                {/* Emoji Background */}
                <div className="absolute -right-4 -bottom-4 text-8xl opacity-20 select-none">
                  {meta.emoji}
                </div>

                {/* Content */}
                <div className="relative z-10">
                  <span className="text-4xl mb-3 block">{meta.emoji}</span>
                  <h3 className="font-bold text-xl mb-1">{category.name}</h3>
                  {category.article_count !== undefined && (
                    <p className="text-white/70 text-sm">
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
