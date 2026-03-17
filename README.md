# Mukoko News

> **Africa's Digital News Platform & API**

"Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. A Pan-African news platform that aggregates, enriches, and distributes news from 56+ sources across 16 countries.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Overview

Mukoko News is a **two-sided news platform**: publishers push content in, and consumers (apps, smart homes, AI agents, companies) pull it out through a unified API.

### Platform Capabilities

- **Publisher Portal**: Claim news sources, DNS verification, direct article push API
- **MCP Server**: Model Context Protocol integration for AI clients (Claude, Cursor)
- **Embed Widgets**: 5 layouts, 4 feed types, 16 countries — sandboxed iframes for sister apps
- **Open Data Analytics**: Public API — all non-PII analytics are open, no auth required
- **API Key Management**: 5-tier self-service keys (free → enterprise)
- **Webhook System**: 14 event types, HMAC signing, retry with exponential backoff
- **Smart Home**: Alexa Flash Briefing, Google Assistant, Apple HomePod
- **Content Moderation**: AI + pattern detection, cultural alignment scoring, fact-checking

### News API

- **56+ RSS Sources** across 16 Pan-African countries (Zimbabwe primary market)
- **AI-Powered**: Anthropic Claude for keyword extraction, quality scoring
- **Hybrid Search**: Apache Doris funnel → Postgres hydration → ILIKE fallback
- **Story Clustering**: Jaccard similarity groups related coverage
- **Schema.org Compliant**: All responses follow NewsArticle conventions
- **8 JSON-LD Types**: NewsArticle, Organization, BreadcrumbList, WebSite, WebPage, ItemList, CollectionPage, SoftwareApplication

### Consumer Experience (migrating to super app)

- **Personalized Feeds**: Country/category filtering
- **TikTok-Style NewsBytes**: Vertical swipe feed for short-form news
- **Dark Mode**: System detection + manual toggle
- **WCAG AAA**: 7:1 contrast ratios, semantic HTML, keyboard navigation

> The interactive reading experience is migrating to the **Mukoko super app** (`app.mukoko.com`). This repo is the platform layer.

## Project Structure

```text
mukoko-news/
├── src/                 # Next.js 15 frontend (platform dashboard + consumer pages)
│   ├── app/
│   │   ├── platform/    # Publisher portal, author portal, tools (MCP, embed, RSS)
│   │   ├── admin/       # Admin dashboard
│   │   ├── embed/       # Embeddable news widgets
│   │   └── ...          # Consumer pages (migrating to super app)
│   ├── components/      # React components (Radix UI + Tailwind)
│   ├── contexts/        # React contexts (preferences, theme)
│   └── lib/             # API client, utilities, constants
├── fly-worker/          # FastAPI backend on Fly.io (production news API)
│   ├── src/api/         # 12 API routers (42+ endpoints)
│   ├── src/jobs/        # 6 background jobs (RSS, engagement, trending, etc.)
│   └── src/services/    # Business logic (AI, RSS, CouchDB, Doris)
├── mcp-server/          # MCP server for AI clients (9 tools, 5 resources)
├── backend/             # Platform services (TypeScript, migration target)
│   └── services/platform/ # Publisher, API keys, webhooks, moderation, open data
├── database/            # SQL migrations (Postgres + platform tables)
├── public/              # Static assets + embed widget script
└── CLAUDE.md            # AI assistant instructions
```

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+ (for fly-worker)
- Fly.io CLI (for backend deployment)

### Frontend

```bash
npm install
npm run dev              # Start Next.js dev server (port 3000)
npm run build            # Build for production
npm run typecheck        # TypeScript check
npm run test             # Run Vitest tests (421 tests)
```

### Backend

```bash
cd fly-worker
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8080
pytest                   # Run tests
```

### MCP Server

```bash
cd mcp-server
npm install
MUKOKO_API_SECRET=your-secret node src/index.js
```

### Environment Variables

Create `.env.local` in the root directory:

```env
NEXT_PUBLIC_API_URL=https://mukoko-news-api.fly.dev
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com
NEXT_PUBLIC_API_SECRET=your_api_secret_here
API_SECRET=your_api_secret_here
```

## API

**Base URL**: `https://mukoko-news-api.fly.dev`

| Category | Endpoints | Auth |
|----------|-----------|------|
| Feeds & Articles | `/api/feeds`, `/api/article/:id`, `/api/news-bytes` | Bearer token |
| Discovery | `/api/categories`, `/api/keywords`, `/api/sources`, `/api/search` | Bearer token |
| Engagement | `/api/articles/:id/like\|save\|view` | Bearer token |
| Stories & Authors | `/api/stories/trending`, `/api/authors` | Bearer token |
| **Analytics (open data)** | `/api/analytics/*` (8 endpoints) | **Public** |
| Admin | `/api/admin/*` (6 endpoints) | Admin secret |
| Health | `/health`, `/api/health` | **Public** |

Full API documentation: [api-schema.yml](api-schema.yml)

## Architecture

```
Frontend (Vercel) ──Bearer Token──→ News API (Fly.io) ──→ Postgres (Supabase)
                                                      ──→ CouchDB (doc store)
                                                      ──→ Doris (analytics/search)
                                                      ──→ Anthropic Claude (AI)

MCP Server (local) ──Bearer Token──→ News API (Fly.io)
```

### Design System (Nyuchi Brand v6)

```
Primary:    Tanzanite (#4B0082)     Headings:  Noto Serif
Secondary:  Cobalt (#0047AB)        Body:      Plus Jakarta Sans
Accent:     Gold (#5D4037)          Radius:    12px buttons, 16px cards
Success:    Malachite (#2E8B57)     Contrast:  WCAG AAA (7:1)
Warning:    Terracotta (#E07A4D)
Surface:    Warm Cream (#FAF9F5)
```

## Testing

- **Frontend**: 421 tests in 19 files (Vitest + React Testing Library)
- **Backend**: pytest with async mode (content cleaner, engagement, quality, RSS)
- **Security**: CSS injection, XSS prevention, JSON-LD injection, URL traversal tests

```bash
npm run test              # Frontend tests
cd fly-worker && pytest   # Backend tests
```

## Deployment

- **Frontend**: Auto-deploys to Vercel on push to main
- **Backend**: `cd fly-worker && fly deploy`
- **MCP Server**: npm package, runs locally via stdio transport
- **CI/CD**: GitHub Actions → typecheck → lint → build → deploy → health check

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Documentation

- [CLAUDE.md](CLAUDE.md) — AI assistant instructions (platform architecture)
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
- [SECURITY.md](SECURITY.md) — Security policy
- [api-schema.yml](api-schema.yml) — OpenAPI specification

## License

MIT License — see [LICENSE](LICENSE) for details.

## About Mukoko

"Ndiri nekuti tiri" — I am because we are

Mukoko ("Beehive" in Shona) represents the collective knowledge and community of Africa. Just as bees work together to create something greater than themselves, Mukoko News brings together voices from across the continent to inform and empower African communities.

---

Built with love by [Nyuchi Technologies](https://brand.nyuchi.com)
