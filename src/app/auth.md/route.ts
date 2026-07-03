import { SITE_URL, GATEWAY_URL, MCP_ENDPOINT, OAUTH_ISSUER, MCP_CLIENT_ID } from '@/lib/agent-discovery'

// /auth.md — human- and agent-readable authentication guide, served as Markdown
// from the site root (the auth.md convention: https://workos.com/auth-md).
// Describes the REAL flow: WorkOS AuthKit (identity.nyuchi.com) via OAuth 2.0
// authorization-code + PKCE, using the published public MCP client. We do NOT
// advertise a dynamic-registration endpoint because the platform doesn't run
// open DCR — agents use the fixed public client id below.
export const runtime = 'edge'
export const dynamic = 'force-static'

const BODY = `# auth.md

Authentication for agents accessing **Mukoko News** (${SITE_URL}) and its product
API + Model Context Protocol server at ${GATEWAY_URL}.

## TL;DR

- **Most data is public.** The MCP server (${MCP_ENDPOINT}) and the read APIs need
  **no authentication** — briefings, search, source views and open-data analytics
  are open. Point your agent at the MCP endpoint and start calling tools.
- **Personalized and privileged actions require OAuth.** \`get_my_feed\`, the
  \`/api/user/*\` endpoints (publisher dashboard, claims) and \`/api/admin/*\`
  (staff) require a WorkOS-issued bearer token.

## Authorization server

Authentication is handled by **WorkOS AuthKit**. Discovery metadata:

- OAuth 2.0 Authorization Server Metadata: \`${SITE_URL}/.well-known/oauth-authorization-server\`
- OAuth 2.0 Protected Resource Metadata: \`${SITE_URL}/.well-known/oauth-protected-resource\`
- MCP Server Card: \`${SITE_URL}/.well-known/mcp/server-card.json\`

| Field | Value |
| --- | --- |
| \`issuer\` | \`${OAUTH_ISSUER}\` |
| \`authorization_endpoint\` | \`${OAUTH_ISSUER}/oauth/authorize\` |
| \`token_endpoint\` | \`${OAUTH_ISSUER}/oauth/token\` |
| \`jwks_uri\` | \`${OAUTH_ISSUER}/.well-known/jwks.json\` |
| \`grant_types_supported\` | \`authorization_code\`, \`refresh_token\` |
| \`code_challenge_methods_supported\` | \`S256\` (PKCE required) |
| \`token_endpoint_auth_methods_supported\` | \`none\` (public client) |

## Registration

The platform does **not** run open Dynamic Client Registration. Agents authenticate
with the **published public client** below using the standard OAuth 2.0
authorization-code flow with **PKCE** — no client secret, no pre-registration.

- **Client ID:** \`${MCP_CLIENT_ID}\`
- **Method:** \`authorization_code\` + PKCE (\`S256\`)
- **Identity:** an end user authenticates via WorkOS (passwordless email code /
  hosted AuthKit); the agent receives a bearer token scoped to that user.

## Using the token

Send the WorkOS access token as a bearer header:

\`\`\`
Authorization: Bearer <access_token>
\`\`\`

The gateway re-verifies the JWT (RS256, JWKS above) and enforces role-based access
(org-scoped to the platform team for admin/moderator surfaces).

## Contact

Operated by Nyuchi Africa. See ${SITE_URL}/privacy and ${SITE_URL}/terms.
`

export function GET() {
  return new Response(BODY, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
