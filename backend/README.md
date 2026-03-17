# Mukoko News — Cloudflare Worker (Minimal Shim)

The **production News API** has moved to **Fly.io** (`fly-worker/`).

This worker is a lightweight shim that:
- Preserves Cloudflare bindings (D1, Workers AI, KV, R2, Analytics Engine)
- Serves health check endpoints
- Redirects API requests to the production Fly.io API

## Platform Services (Active Design)

`services/platform/` contains TypeScript designs for 10 platform services
that are the next migration target to `fly-worker/`:

- **PublisherService** — Publisher registration, DNS verification, article push
- **APIKeyService** — 5-tier API key management (free → enterprise)
- **WebhookService** — Event-driven webhooks, HMAC signing, retry
- **ContentModerationService** — AI moderation, cultural alignment
- **OpenDataService** — Open data manifesto, bulk export
- **SmartHomeBriefingService** — Alexa, Google, HomePod briefings
- **SSEStreamService** — Server-sent events for real-time updates
- **FeedOutputService** — Feed formatting & output
- **DynamicDataService** — Dynamic categories, keywords, sources, countries

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Local dev server
npm run deploy    # Deploy to Cloudflare
npm run typecheck # TypeScript check
```
