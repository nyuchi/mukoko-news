import type { MetadataRoute } from 'next'

import { getLiveCoverageAction } from '@/lib/actions/coverage'

/**
 * The web app manifest, generated rather than served from `public/`.
 *
 * Its `description` stated the coverage claim as a literal "16". A static file
 * cannot follow a live count, so it would have drifted the moment a country was
 * added — and a manifest description is what an installed PWA shows in the app
 * listing, so the stale number would have outlived the page that corrected it.
 *
 * `public/manifest.json` is deleted; a file there would shadow this route.
 */
export const revalidate = 3600

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { claim } = await getLiveCoverageAction()

  return {
    description: `Pan-African digital news aggregation platform. Breaking news, top stories and in-depth coverage. ${claim}`,
    ...({
        "name": "mukoko news",
        "short_name": "mukoko",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#1A0033",
        "theme_color": "#4B0082",
        "orientation": "portrait-primary",
        "icons": [
            {
                "src": "/favicon.ico",
                "sizes": "48x48",
                "type": "image/x-icon"
            },
            {
                "src": "/favicon.svg",
                "sizes": "any",
                "type": "image/svg+xml"
            },
            {
                "src": "/icon-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any"
            },
            {
                "src": "/icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any"
            },
            {
                "src": "/icon-maskable-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "maskable"
            },
            {
                "src": "/icon-maskable-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable"
            }
        ],
        "categories": [
            "news",
            "politics",
            "business",
            "sports",
            "africa"
        ],
        "lang": "en",
        "dir": "ltr",
        "scope": "/",
        "id": "mukoko-news",
        "related_applications": [],
        "prefer_related_applications": false,
        "shortcuts": [
            {
                "name": "Discover",
                "short_name": "Discover",
                "description": "Explore African news by category and country",
                "url": "/discover"
            },
            {
                "name": "NewsBytes",
                "short_name": "NewsBytes",
                "description": "Quick-scroll news feed",
                "url": "/newsbytes"
            },
            {
                "name": "Search",
                "short_name": "Search",
                "description": "Search African news",
                "url": "/search"
            }
        ]
    } as Omit<MetadataRoute.Manifest, 'description'>),
  }
}
