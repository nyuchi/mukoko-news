import { oauthAuthorizationServerMetadata, AGENT_JSON_HEADERS } from '@/lib/agent-discovery'

// OAuth 2.0 Authorization Server Metadata (RFC 8414). Mirrors what the gateway
// publishes (issuer = WorkOS identity.nyuchi.com) so an agent discovering the
// site at news.mukoko.com finds the same authorization server. Served at
// /.well-known/oauth-authorization-server.
export const runtime = 'edge'
export const dynamic = 'force-static'

export function GET() {
  return new Response(JSON.stringify(oauthAuthorizationServerMetadata(), null, 2), {
    headers: AGENT_JSON_HEADERS,
  })
}
