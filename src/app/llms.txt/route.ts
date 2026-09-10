import { getLiveCoverageAction } from '@/lib/actions/coverage'

/**
 * llms.txt, generated rather than served from `public/`.
 *
 * This file exists to be read by answer engines, and it stated the coverage
 * claim as a literal "16". That is the single worst place for a stale number:
 * an LLM that crawls it caches the figure and repeats it long after the site
 * has corrected itself, which is precisely the drift the one-sanctioned-claim
 * rule was written to stop.
 *
 * `public/llms.txt` is deleted; a file there would shadow this route silently.
 */
export const revalidate = 3600

export async function GET(): Promise<Response> {
  const { claim } = await getLiveCoverageAction()

  const body = `# Mukoko News

> Pan-African news aggregation — briefings, search, source views and open-data analytics. "Mukoko" means "beehive" in Shona.

## Coverage

${claim} Country pages for the countries that are not live say so rather than showing an empty result set; only the live countries are submitted in the sitemap.

Mukoko aggregates other newsrooms' reporting and does not publish it. Article representations here carry an EXCERPT and a link to the originating publisher, never the full text; the publisher named on each article is the newsroom that wrote it.

## For AI agents

- [MCP Server Card](https://news.mukoko.com/.well-known/mcp/server-card.json): discover the Model Context Protocol server (hosted at https://news.mukoko.dev/mcp). Most tools are public — no auth needed.
- [Authentication guide](https://news.mukoko.com/auth.md): how agents authenticate for personalized/privileged actions (WorkOS OAuth 2.0 + PKCE).
- [OAuth Authorization Server Metadata](https://news.mukoko.com/.well-known/oauth-authorization-server)
- [OAuth Protected Resource Metadata](https://news.mukoko.com/.well-known/oauth-protected-resource)

\`/\` and \`/article/<id>\` support \`Accept: text/markdown\` — request either with that header (and without \`text/html\`) to get a clean markdown version. Other routes return HTML. In-browser agents can use the WebMCP tools registered via \`navigator.modelContext\` (search, latest headlines, open article).

## Open data

- [Open-data export](https://news.mukoko.com/api/insights/export?format=json): aggregate analytics (publishing volume, sources, categories, country coverage).
- [Insights dashboard](https://news.mukoko.com/insights)

## Policies

- [Privacy](https://news.mukoko.com/privacy)
- [Terms](https://news.mukoko.com/terms)
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
