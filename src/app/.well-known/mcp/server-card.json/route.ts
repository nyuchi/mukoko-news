import { MCP_ENDPOINT, SITE_URL, GATEWAY_URL, OAUTH_ISSUER, AGENT_JSON_HEADERS } from '@/lib/agent-discovery'

// MCP Server Card (SEP-1649) — lets agents discover the Mukoko News MCP server.
// The server itself is hosted by the gateway at news.mukoko.dev/mcp; this card
// is published at the site root so an agent that finds news.mukoko.com can
// locate the tools. Served at /.well-known/mcp/server-card.json.
export const runtime = 'edge'
export const dynamic = 'force-static'

export function GET() {
  const card = {
    serverInfo: {
      name: 'mukoko-news',
      version: '2.0.0',
      title: 'Mukoko News',
      description:
        'Pan-African news aggregation for Zimbabwe and 15 other African countries — briefings, search, source views and open-data analytics.',
    },
    transport: {
      type: 'streamable-http',
      endpoint: MCP_ENDPOINT,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    authorization: {
      type: 'oauth2',
      authorization_servers: [OAUTH_ISSUER],
      // Most tools are public reads; only get_my_feed + platform-team tools need a token.
      required: false,
    },
    documentation: `${SITE_URL}/auth.md`,
    website: SITE_URL,
    provider: {
      name: 'Nyuchi Africa',
      url: GATEWAY_URL,
    },
  }
  return new Response(JSON.stringify(card, null, 2), { headers: AGENT_JSON_HEADERS })
}
