import { SITE_URL, GATEWAY_URL, OAUTH_ISSUER, AGENT_JSON_HEADERS } from '@/lib/agent-discovery'

// OAuth 2.0 Protected Resource Metadata (RFC 9728). Tells agents which
// authorization server(s) issue tokens for Mukoko's protected APIs (the
// personalized MCP tools + the gateway's /api/user & /api/admin surfaces) and
// what scopes exist. Served at /.well-known/oauth-protected-resource.
export const runtime = 'edge'
export const dynamic = 'force-static'

export function GET() {
  const metadata = {
    resource: SITE_URL,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
    // The protected product API + MCP live on the gateway host.
    resource_documentation: `${SITE_URL}/auth.md`,
    resource_servers: [GATEWAY_URL],
  }
  return new Response(JSON.stringify(metadata, null, 2), { headers: AGENT_JSON_HEADERS })
}
