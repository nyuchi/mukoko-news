# Agent readiness (AI-agent discovery)

Makes `news.mukoko.com` discoverable and usable by AI agents. Tracks the
[isitagentready.com](https://isitagentready.com) checklist. Most items ship as
code in this repo; two are DNS/registrar infrastructure and are documented here
for whoever manages the `mukoko.com` zone.

## Shipped in code (this repo)

| Capability | Where | URL |
| --- | --- | --- |
| **MCP Server Card** (SEP-1649) | `public/.well-known/mcp/server-card.json` (static) | `/.well-known/mcp/server-card.json` |
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

## DNS infrastructure (Cloudflare zone `mukoko.com`)

### 1. DNS for AI Discovery (DNS-AID) — ✅ published

ServiceMode SVCB entrypoint records under `_agents.news.mukoko.com` let resolvers
find the MCP / A2A endpoints without an HTTP round-trip.
Refs: [draft-mozleywilliams-dnsop-dnsaid](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/),
[RFC 9460 (SVCB/HTTPS)](https://www.rfc-editor.org/rfc/rfc9460).

Live records (verified resolving via Cloudflare + Google DoH):

```
_index._agents.news.mukoko.com. 3600 IN SVCB 1 news.mukoko.dev. alpn="mcp" port=443 mandatory=alpn,port
_mcp._agents.news.mukoko.com.   3600 IN SVCB 1 news.mukoko.dev. alpn="mcp" port=443 mandatory=alpn,port
_a2a._agents.news.mukoko.com.   3600 IN SVCB 1 news.mukoko.com. alpn="a2a" port=443 mandatory=alpn,port
```

- `_index` / `_mcp` → the gateway host serving `/mcp` (`news.mukoko.dev`).
- `_a2a` → `news.mukoko.com` (repoint the target if the A2A endpoint moves to a
  dedicated host).
- Verify: `dig SVCB _index._agents.news.mukoko.com +dnssec`.

### 2. DNSSEC — ⏳ signed, pending the registrar DS

The zone is DNSSEC-signed at Cloudflare (DNSKEYs published). `mukoko.com` is
registered at **GoDaddy** (DNS is on Cloudflare, but the registrar is GoDaddy),
so the chain of trust is completed by adding the **DS record at GoDaddy** — it is
**not** automatic (that only happens on Cloudflare Registrar).

Add at **GoDaddy → mukoko.com → DNSSEC**:

| Field | Value |
| --- | --- |
| Key Tag | `2371` |
| Algorithm | `13` (ECDSA P-256 SHA-256) |
| Digest Type | `2` (SHA-256) |
| Digest | `06DF6D2D55147420459DB2E0FEC64F911A8E43E9D0105C059FDD06D83FFC6867` |

Once GoDaddy publishes the DS, the `.com` parent gets it, RDAP
`secureDNS.delegationSigned` flips to `true`, and Cloudflare's DNSSEC status goes
`pending → active` (usually within an hour).

- Verify: `dig DS mukoko.com +dnssec` (non-empty once live) and
  `dig DNSKEY mukoko.com +dnssec`.

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
backed by the code above should read `"pass"`. **DNS-AID** passes now (records
resolve); **DNSSEC** passes once the GoDaddy DS is published (§2 above).
