/**
 * Shared constants for the agent-discovery surface (the `/.well-known/*` +
 * `/auth.md` + WebMCP endpoints that make news.mukoko.com discoverable to AI
 * agents). Values mirror the REAL config the gateway already advertises:
 *  - the MCP server lives at news.mukoko.dev/mcp (nyuchi/mukoko-news-gateway),
 *  - the OAuth authorization server is WorkOS at identity.nyuchi.com (the same
 *    issuer the gateway's /.well-known/oauth-authorization-server publishes).
 * Keep these in sync with `index.ts` in the gateway if that config changes.
 */

/** The public site (this app). */
export const SITE_URL = 'https://news.mukoko.com'
/** The product API + MCP host (gateway). */
export const GATEWAY_URL = 'https://news.mukoko.dev'
/** The MCP JSON-RPC endpoint. */
export const MCP_ENDPOINT = `${GATEWAY_URL}/mcp`
/** WorkOS AuthKit issuer (the OAuth/OIDC authorization server). */
export const OAUTH_ISSUER = 'https://identity.nyuchi.com'
/** The public MCP OAuth client id (PKCE, no secret) — mirrors WORKOS_MCP_CLIENT_ID. */
export const MCP_CLIENT_ID = 'client_01KV2GGE5A7WRSFPWZ5HQJ3FNZ'

/** OAuth 2.0 Authorization Server Metadata (RFC 8414) — mirrors the gateway. */
export function oauthAuthorizationServerMetadata() {
  return {
    issuer: OAUTH_ISSUER,
    authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`,
    token_endpoint: `${OAUTH_ISSUER}/oauth/token`,
    jwks_uri: `${OAUTH_ISSUER}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['openid', 'profile', 'email'],
    client_id: MCP_CLIENT_ID,
  }
}

/** JSON response headers for a public, cacheable, agent-readable metadata document. */
export const AGENT_JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
}
