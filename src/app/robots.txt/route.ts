import { BASE_URL } from '@/lib/constants'
import { getLiveCoverageAction } from '@/lib/actions/coverage'

/**
 * robots.txt, generated rather than served from `public/`.
 *
 * It moved because its header stated the coverage claim as a literal "16", and
 * the claim is now a live count. A static file cannot follow that, so it would
 * have sat at 16 while every other surface moved — recreating exactly the
 * nine-surfaces-disagreeing problem the single claim was built to end.
 *
 * A raw Route Handler rather than Next's `app/robots.ts` convention because
 * `MetadataRoute.Robots` has no way to emit a comment line, and the claim here
 * IS a comment. Crawlers ignore it; the answer engines that read robots.txt as
 * prose do not, which is why it was written in the first place.
 *
 * `public/robots.txt` is deleted. A file there would SHADOW this route and win
 * silently — the worst possible failure mode for a crawler-facing document,
 * since nothing in the app would look wrong.
 */
export const revalidate = 3600

export async function GET(): Promise<Response> {
  const { claim } = await getLiveCoverageAction()

  const body = `# Mukoko News Robots.txt
# ${BASE_URL}
# Pan-African news aggregator. ${claim}

User-agent: *
Allow: /
Disallow: /api/
Disallow: /profile
Disallow: /saved
Disallow: /embed/iframe
Allow: /api/schema

# Google News bot - explicitly welcome
User-agent: Googlebot-News
Allow: /

# Sitemaps
Sitemap: ${BASE_URL}/sitemap.xml
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
