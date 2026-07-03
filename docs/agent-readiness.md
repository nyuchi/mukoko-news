# Agent readiness (AI-agent discovery)

Makes `news.mukoko.com` discoverable and usable by AI agents. Tracks the
[isitagentready.com](https://isitagentready.com) checklist. Most items ship as
code in this repo; two are DNS/registrar infrastructure and are documented here
for whoever manages the `mukoko.com` zone.

## Shipped in code (this repo)

| Capability | Where | URL |
| --- | --- | --- |
| **MCP Server Card** (SEP-1649) | `src/app/.well-known/mcp/server-card.json/route.ts` | `/.well-known/mcp/server-card.json` |
| **OAuth Authorization Server Metadata** (RFC 8414) | `src/app/.well-known/oauth-authorization-server/route.ts` | `/.well-known/oauth-authorization-server` |
| **OAuth Protected Resource Metadata** (RFC 9728) | `src/app/.well-known/oauth-protected-resource/route.ts` | `/.well-known/oauth-protected-resource` |
| **auth.md** (agent auth guide) | `src/app/auth.md/route.ts` | `/auth.md` |
| **Markdown for Agents** (`Accept: text/markdown`) | `src/middleware.ts` + `src/app/api/agent-md/route.ts` | `/` and `/article/[id]` |
| **WebMCP** (in-browser tools) | `src/components/agent/webmcp-provider.tsx` | any page (`navigator.modelContext`) |
| Pointers | `public/llms.txt` | `/llms.txt` |

Shared values (MCP endpoint, WorkOS issuer, client id) live in
`src/lib/agent-discovery.ts` and mirror what the **gateway**
(`nyuchi/mukoko-news-gateway`) already publishes — keep them in sync if the
gateway's OAuth/MCP config changes.

### Notes on choices

- **Markdown for Agents is implemented in middleware**, not via Cloudflare's
  automatic feature — `news.mukoko.com` is served by **Vercel**, so the
  Cloudflare "Markdown for Agents" toggle does not apply. The middleware rewrites
  `GET` requests carrying `Accept: text/markdown` (and *not* `text/html`) to a
  responder that returns `text/markdown` + `x-markdown-tokens`; browsers keep the
  HTML page (`Vary: Accept`).
- **auth.md is honest about registration.** The platform does **not** run open
  Dynamic Client Registration, so we advertise the fixed **public MCP client id**
  with the authorization-code/PKCE flow rather than a `register_uri` that would 404.
- **OIDC discovery**: we publish `oauth-authorization-server` (RFC 8414), which
  the audit accepts in lieu of `openid-configuration`. We deliberately do *not*
  publish an `openid-configuration` we can't fully back (e.g. a guessed
  `userinfo_endpoint`).

## Infrastructure — needs DNS/registrar access (NOT in this repo)

### 1. DNS for AI Discovery (DNS-AID)

Publish agent-discovery entrypoint records under the zone so resolvers can find
the MCP (and any A2A) endpoints without an HTTP round-trip.
Refs: [draft-mozleywilliams-dnsop-dnsaid](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/),
[RFC 9460 (SVCB/HTTPS)](https://www.rfc-editor.org/rfc/rfc9460).

Add **ServiceMode SVCB** records (the MCP server is hosted on the gateway host
`news.mukoko.dev`):

```
; MCP discovery entrypoint
_index._agents.news.mukoko.com. 3600 IN SVCB 1 news.mukoko.dev. (
    alpn="h2,h3" port=443 )
_mcp._agents.news.mukoko.com.   3600 IN SVCB 1 news.mukoko.dev. (
    alpn="h2" port=443 )
```

- Point the endpoint at the host actually serving `/mcp` (`news.mukoko.dev`).
- If/when an A2A endpoint exists, add `_a2a._agents.news.mukoko.com.` similarly.
- Confirm with: `dig SVCB _index._agents.news.mukoko.com +dnssec`.

### 2. DNSSEC on the discovery zone

Sign the `mukoko.com` zone (or the delegated `_agents` sub-zone) with **DNSSEC**
so validating resolvers return authenticated discovery data.

- Cloudflare: **DNS → Settings → DNSSEC → Enable**, then add the returned **DS
  record** at the registrar. (If DNS is elsewhere, enable signing there and
  publish the DS at the registrar.)
- Verify: `dig DNSKEY mukoko.com +dnssec` and check the DS chain at the registrar.

## Validate

```
curl -s https://news.mukoko.com/.well-known/mcp/server-card.json | jq .
curl -s https://news.mukoko.com/.well-known/oauth-protected-resource | jq .
curl -s https://news.mukoko.com/.well-known/oauth-authorization-server | jq .
curl -s https://news.mukoko.com/auth.md
curl -s -H 'Accept: text/markdown' https://news.mukoko.com/            # markdown index
curl -sI -H 'Accept: text/markdown' https://news.mukoko.com/           # Content-Type: text/markdown
```

Then re-run the isitagentready.com audit — every `checks.discovery.*.status`
backed by the code above should read `"pass"`; the two DNS checks pass once the
records + DNSSEC are live.
