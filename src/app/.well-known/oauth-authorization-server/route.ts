// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Required by MCP clients to discover authentication endpoints.
// Points to identity.nyuchi.com as the authorization server.
export function GET() {
  const auth = 'https://identity.nyuchi.com'
  const clientId = process.env.WORKOS_CLIENT_ID ?? 'client_01KV2GGE5A7WRSFPWZ5HQJ3FNZ'

  return Response.json(
    {
      issuer: auth,
      authorization_endpoint: `${auth}/oauth/authorize`,
      token_endpoint: `${auth}/oauth/token`,
      jwks_uri: `${auth}/.well-known/jwks.json`,
      registration_endpoint: undefined,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      // PKCE public client — no secret required
      client_id: clientId,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
