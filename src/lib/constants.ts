// Pan-African countries — all 54 African Union member states
// Single source of truth - used by preferences, discover, and other pages
export const COUNTRIES = [
  // East Africa
  { code: "ZW", name: "Zimbabwe", flag: "🇿🇼", color: "bg-green-600" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", color: "bg-red-600" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿", color: "bg-blue-500" },
  { code: "UG", name: "Uganda", flag: "🇺🇬", color: "bg-yellow-600" },
  { code: "RW", name: "Rwanda", flag: "🇷🇼", color: "bg-cyan-500" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹", color: "bg-green-400" },
  { code: "BI", name: "Burundi", flag: "🇧🇮", color: "bg-red-400" },
  { code: "DJ", name: "Djibouti", flag: "🇩🇯", color: "bg-sky-500" },
  { code: "ER", name: "Eritrea", flag: "🇪🇷", color: "bg-green-700" },
  { code: "SO", name: "Somalia", flag: "🇸🇴", color: "bg-blue-400" },
  { code: "SS", name: "South Sudan", flag: "🇸🇸", color: "bg-black" },
  { code: "KM", name: "Comoros", flag: "🇰🇲", color: "bg-green-500" },
  { code: "MG", name: "Madagascar", flag: "🇲🇬", color: "bg-red-500" },
  { code: "MU", name: "Mauritius", flag: "🇲🇺", color: "bg-blue-600" },
  { code: "SC", name: "Seychelles", flag: "🇸🇨", color: "bg-blue-700" },
  // Southern Africa
  { code: "ZA", name: "South Africa", flag: "🇿🇦", color: "bg-yellow-500" },
  { code: "BW", name: "Botswana", flag: "🇧🇼", color: "bg-sky-400" },
  { code: "ZM", name: "Zambia", flag: "🇿🇲", color: "bg-orange-500" },
  { code: "MW", name: "Malawi", flag: "🇲🇼", color: "bg-red-500" },
  { code: "NA", name: "Namibia", flag: "🇳🇦", color: "bg-blue-600" },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿", color: "bg-yellow-500" },
  { code: "LS", name: "Lesotho", flag: "🇱🇸", color: "bg-blue-800" },
  { code: "SZ", name: "Eswatini", flag: "🇸🇿", color: "bg-blue-500" },
  { code: "AO", name: "Angola", flag: "🇦🇴", color: "bg-red-700" },
  // West Africa
  { code: "NG", name: "Nigeria", flag: "🇳🇬", color: "bg-green-500" },
  { code: "GH", name: "Ghana", flag: "🇬🇭", color: "bg-yellow-400" },
  { code: "SN", name: "Senegal", flag: "🇸🇳", color: "bg-green-600" },
  { code: "CI", name: "Côte d'Ivoire", flag: "🇨🇮", color: "bg-orange-600" },
  { code: "CM", name: "Cameroon", flag: "🇨🇲", color: "bg-green-700" },
  { code: "BJ", name: "Benin", flag: "🇧🇯", color: "bg-green-500" },
  { code: "BF", name: "Burkina Faso", flag: "🇧🇫", color: "bg-red-600" },
  { code: "CV", name: "Cabo Verde", flag: "🇨🇻", color: "bg-blue-700" },
  { code: "GM", name: "Gambia", flag: "🇬🇲", color: "bg-red-500" },
  { code: "GN", name: "Guinea", flag: "🇬🇳", color: "bg-red-600" },
  { code: "GW", name: "Guinea-Bissau", flag: "🇬🇼", color: "bg-red-700" },
  { code: "LR", name: "Liberia", flag: "🇱🇷", color: "bg-red-700" },
  { code: "ML", name: "Mali", flag: "🇲🇱", color: "bg-green-600" },
  { code: "MR", name: "Mauritania", flag: "🇲🇷", color: "bg-green-700" },
  { code: "NE", name: "Niger", flag: "🇳🇪", color: "bg-orange-500" },
  { code: "SL", name: "Sierra Leone", flag: "🇸🇱", color: "bg-blue-500" },
  { code: "TG", name: "Togo", flag: "🇹🇬", color: "bg-green-500" },
  { code: "GQ", name: "Equatorial Guinea", flag: "🇬🇶", color: "bg-green-600" },
  { code: "ST", name: "São Tomé and Príncipe", flag: "🇸🇹", color: "bg-green-700" },
  // Central Africa
  { code: "CD", name: "DR Congo", flag: "🇨🇩", color: "bg-blue-600" },
  { code: "CG", name: "Republic of Congo", flag: "🇨🇬", color: "bg-green-600" },
  { code: "CF", name: "Central African Republic", flag: "🇨🇫", color: "bg-blue-700" },
  { code: "TD", name: "Chad", flag: "🇹🇩", color: "bg-yellow-600" },
  { code: "GA", name: "Gabon", flag: "🇬🇦", color: "bg-green-500" },
  // North Africa
  { code: "EG", name: "Egypt", flag: "🇪🇬", color: "bg-red-700" },
  { code: "MA", name: "Morocco", flag: "🇲🇦", color: "bg-red-600" },
  { code: "TN", name: "Tunisia", flag: "🇹🇳", color: "bg-red-500" },
  { code: "DZ", name: "Algeria", flag: "🇩🇿", color: "bg-green-700" },
  { code: "LY", name: "Libya", flag: "🇱🇾", color: "bg-black" },
  { code: "SD", name: "Sudan", flag: "🇸🇩", color: "bg-red-600" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

// Category emoji and color mapping
export const CATEGORY_META: Record<string, { emoji: string; color: string }> = {
  all: { emoji: "📰", color: "bg-gray-500" },
  politics: { emoji: "🏛️", color: "bg-red-500" },
  economy: { emoji: "💰", color: "bg-emerald-500" },
  business: { emoji: "💼", color: "bg-emerald-600" },
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
  science: { emoji: "🔬", color: "bg-purple-500" },
  culture: { emoji: "🎭", color: "bg-rose-500" },
  lifestyle: { emoji: "✨", color: "bg-pink-400" },
  travel: { emoji: "✈️", color: "bg-sky-500" },
  food: { emoji: "🍽️", color: "bg-orange-400" },
};

// Category emoji helper
export function getCategoryEmoji(slug: string): string {
  if (!slug) return "📰";
  return CATEGORY_META[slug.toLowerCase()]?.emoji || "📰";
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
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalizedPath}`;
}
