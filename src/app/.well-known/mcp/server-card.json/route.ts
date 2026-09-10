import { getLiveCoverageAction } from '@/lib/actions/coverage'

/**
 * The MCP server card, generated rather than served from `public/`.
 *
 * Its `serverInfo.description` stated the coverage claim as a literal "16".
 * This document is how an MCP client decides what this server is for, so a
 * stale figure here is repeated by every agent that connects — the same defect
 * as in llms.txt and with a longer tail, because clients cache server cards.
 *
 * `public/.well-known/mcp/server-card.json` is deleted; a file there would
 * shadow this route.
 */
export const revalidate = 3600

export async function GET(): Promise<Response> {
  const { claim } = await getLiveCoverageAction()

  const card = {
    "serverInfo": {
      "name": "mukoko-news",
      "version": "2.0.0",
      "title": "Mukoko News"
    },
    "transport": {
      "type": "streamable-http",
      "endpoint": "https://news.mukoko.dev/mcp"
    },
    "capabilities": {
      "tools": true,
      "resources": false,
      "prompts": false
    },
    "authorization": {
      "type": "oauth2",
      "authorization_servers": [
        "https://identity.nyuchi.com"
      ],
      "required": false
    },
    "documentation": "https://news.mukoko.com/auth.md",
    "website": "https://news.mukoko.com",
    "provider": {
      "name": "Nyuchi Africa",
      "url": "https://news.mukoko.dev"
    }
  }

  return Response.json(
    {
      ...card,
      serverInfo: {
        ...card.serverInfo,
        description: `Pan-African news aggregation. ${claim} Briefings, search, source views and open-data analytics.`,
      },
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
}
