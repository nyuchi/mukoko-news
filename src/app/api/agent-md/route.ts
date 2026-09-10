import { NextRequest } from 'next/server'
import { getArticleAction, getArticlesAction } from '@/lib/actions/feed'
import { BASE_URL, getArticleUrl, COVERAGE_CLAIM } from '@/lib/constants'
import { articleExcerpt } from '@/lib/excerpt'

// Markdown-for-Agents responder. The middleware rewrites GET requests that carry
// `Accept: text/markdown` for `/` and `/article/[id]` here, so agents get a clean
// markdown representation while browsers keep the HTML page. Content-Type is
// `text/markdown` (with `x-markdown-tokens` when we can estimate it).
// See: https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function markdownResponse(body: string) {
  // Rough token estimate (~4 chars/token) — advisory, mirrors the x-markdown-tokens hint.
  const tokens = Math.ceil(body.length / 4)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'x-markdown-tokens': String(tokens),
      Vary: 'Accept',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}

/** Render a single article as markdown. */
async function articleMarkdown(id: string): Promise<Response> {
  const article = await getArticleAction(id)
  if (!article) return new Response('# Not found\n\nNo article matches that id.\n', { status: 404 })

  const parts: string[] = [`# ${article.title}`]
  const meta: string[] = []
  if (article.source) meta.push(`**Source:** ${article.source}`)
  if (article.author) meta.push(`**By:** ${article.author}`)
  if (article.published_at) meta.push(`**Published:** ${article.published_at}`)
  if (meta.length) parts.push(meta.join(' · '))

  // An EXCERPT, not the article. This endpoint used to serve the publisher's
  // complete body — the same text as the JSON-LD `articleBody`, and for the same
  // reason it should not: it let an agent answer a reader in full from Mukoko's
  // origin without the newsroom that wrote it ever being fetched. One shared
  // bound (`@/lib/excerpt`) governs both surfaces so they cannot drift apart
  // again, which is how they each ended up shipping the whole body separately.
  const body = articleExcerpt(article)
  if (body) parts.push(body)

  // Ordering is deliberate: the ORIGINAL comes first. Leading with "Read on
  // Mukoko News" told an agent that the aggregator's copy was the destination
  // and the newsroom was a footnote — the same claim, in link order, that
  // `publisher: "Mukoko News"` was making in the structured data. The full text
  // is at the publisher, so that is the link that says "full article".
  const links: string[] = []
  if (article.original_url) {
    const where = article.source ? ` at ${article.source}` : ''
    links.push(`[Read the full article${where}](${article.original_url})`)
  }
  links.push(`[This article on Mukoko News](${getArticleUrl(article.id)})`)
  parts.push('---', `Excerpt only. ${links.join(' · ')}`)

  return markdownResponse(parts.join('\n\n') + '\n')
}

/** Render the homepage as a markdown index of the latest headlines. */
async function homepageMarkdown(): Promise<Response> {
  const { articles } = await getArticlesAction({ sort: 'latest', limit: 30 })
  const lines: string[] = [
    '# Mukoko News',
    `Pan-African news aggregation. ${COVERAGE_CLAIM}`,
    '',
    '## Latest headlines',
    '',
  ]
  for (const a of articles) {
    const bits = [a.source, a.published_at].filter(Boolean).join(' · ')
    lines.push(`- [${a.title}](${getArticleUrl(a.id)})${bits ? ` — ${bits}` : ''}`)
  }
  lines.push(
    '',
    '---',
    `Full site: ${BASE_URL} · MCP tools + auth: ${BASE_URL}/auth.md`,
    ''
  )
  return markdownResponse(lines.join('\n'))
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') || '/'
  try {
    const article = /^\/article\/([^/]+)\/?$/.exec(path)
    if (article) return await articleMarkdown(decodeURIComponent(article[1]))
    return await homepageMarkdown()
  } catch (err) {
    console.error('[agent-md] render failed', err)
    return new Response('# Mukoko News\n\nContent temporarily unavailable.\n', {
      status: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
  }
}
