// scripts/generate-sitemap.js
// Run this script to generate a sitemap for better SEO
// Usage: node scripts/generate-sitemap.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SITE_URL = 'https://news.mukoko.com'
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://mukoko-news-api.fly.dev'

// Static pages
const STATIC_PAGES = [
  { path: '/', priority: 1.0, changefreq: 'hourly' },
  { path: '/discover', priority: 0.9, changefreq: 'hourly' },
  { path: '/newsbytes', priority: 0.9, changefreq: 'hourly' },
  { path: '/categories', priority: 0.8, changefreq: 'daily' },
  { path: '/insights', priority: 0.8, changefreq: 'daily' },
  { path: '/search', priority: 0.7, changefreq: 'daily' },
  { path: '/help', priority: 0.5, changefreq: 'weekly' },
  { path: '/terms', priority: 0.3, changefreq: 'monthly' },
  { path: '/privacy', priority: 0.3, changefreq: 'monthly' },
]

// Fetch categories from API
async function fetchCategories() {
  try {
    console.log('Fetching categories from API...')
    const response = await fetch(`${API_URL}/api/categories`)

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    console.log(`✅ Fetched ${data.categories.length} categories`)

    return data.categories.map(cat => cat.slug || cat.id)
  } catch (error) {
    console.warn('⚠️  Failed to fetch categories from API:', error.message)
    console.log('Using fallback categories...')

    return [
      'politics', 'business', 'sports', 'entertainment', 'technology',
      'health', 'education', 'world', 'local', 'opinion'
    ]
  }
}

async function generateSitemap() {
  const categories = await fetchCategories()
  const today = new Date().toISOString().split('T')[0]

  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <!-- Static pages -->
${STATIC_PAGES.map(page => `  <url>
    <loc>${SITE_URL}${page.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('\n')}

  <!-- Category pages -->
${categories.map(category => `  <url>
    <loc>${SITE_URL}/discover?category=${category}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
</urlset>`

  // Write sitemap to public directory
  const publicDir = path.join(__dirname, '..', 'public')
  const sitemapPath = path.join(publicDir, 'sitemap.xml')

  fs.writeFileSync(sitemapPath, sitemap, 'utf-8')
  console.log(`✅ Sitemap generated at: ${sitemapPath}`)

  // Generate robots.txt
  const robotsTxt = `# Mukoko News Robots.txt
# https://news.mukoko.com

User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/

# Sitemaps
Sitemap: ${SITE_URL}/sitemap.xml

# Crawl-delay
Crawl-delay: 1

# Pan-African news aggregator
# Covering: Zimbabwe, South Africa, Kenya, Nigeria, Ghana, and more`

  const robotsPath = path.join(publicDir, 'robots.txt')
  fs.writeFileSync(robotsPath, robotsTxt, 'utf-8')
  console.log(`✅ robots.txt generated at: ${robotsPath}`)
}

// Run the generator
generateSitemap()
