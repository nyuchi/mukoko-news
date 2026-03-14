// Pan-African countries supported by Mukoko News
// Single source of truth - used by preferences, discover, and other pages
export const COUNTRIES = [
  { code: "ZW", name: "Zimbabwe", flag: "🇿🇼", color: "bg-green-600" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", color: "bg-yellow-500" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", color: "bg-red-600" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬", color: "bg-green-500" },
  { code: "GH", name: "Ghana", flag: "🇬🇭", color: "bg-yellow-400" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿", color: "bg-blue-500" },
  { code: "UG", name: "Uganda", flag: "🇺🇬", color: "bg-yellow-600" },
  { code: "RW", name: "Rwanda", flag: "🇷🇼", color: "bg-cyan-500" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹", color: "bg-green-400" },
  { code: "BW", name: "Botswana", flag: "🇧🇼", color: "bg-sky-400" },
  { code: "ZM", name: "Zambia", flag: "🇿🇲", color: "bg-orange-500" },
  { code: "MW", name: "Malawi", flag: "🇲🇼", color: "bg-red-500" },
  { code: "EG", name: "Egypt", flag: "🇪🇬", color: "bg-red-700" },
  { code: "MA", name: "Morocco", flag: "🇲🇦", color: "bg-red-600" },
  { code: "NA", name: "Namibia", flag: "🇳🇦", color: "bg-blue-600" },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿", color: "bg-yellow-500" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

// Section (category) emoji and color mapping
export const SECTION_META: Record<string, { emoji: string; color: string }> = {
  all: { emoji: "📰", color: "bg-gray-500" },
  politics: { emoji: "🏛️", color: "bg-red-500" },
  economy: { emoji: "💰", color: "bg-emerald-500" },
  technology: { emoji: "💻", color: "bg-blue-500" },
  sports: { emoji: "⚽", color: "bg-orange-500" },
  health: { emoji: "🏥", color: "bg-green-500" },
  education: { emoji: "📚", color: "bg-violet-500" },
  entertainment: { emoji: "🎬", color: "bg-pink-500" },
  international: { emoji: "🌍", color: "bg-cyan-500" },
  general: { emoji: "📰", color: "bg-lime-500" },
  harare: { emoji: "🏙️", color: "bg-teal-500" },
  agriculture: { emoji: "🌾", color: "bg-amber-500" },
  crime: { emoji: "🚔", color: "bg-red-600" },
  environment: { emoji: "🌍", color: "bg-green-600" },
};

// Section (category) emoji helper
export function getCategoryEmoji(slug: string): string {
  if (!slug) return "📰";
  return SECTION_META[slug.toLowerCase()]?.emoji || "📰";
}

// Base URL for the application
// Uses environment variable in production, falls back to default for development
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://news.mukoko.com";

// Helper to generate full article URLs
export function getArticleUrl(articleId: string): string {
  return `${BASE_URL}/article/${articleId}`;
}

// Helper to generate full URLs from paths
export function getFullUrl(path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalizedPath}`;
}
