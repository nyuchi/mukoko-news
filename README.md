# Mukoko News

> **Africa's Digital News Aggregation Platform**

"Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. A Pan-African news platform built with Next.js 15, serving news from 54 African Union member states.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Overview

Mukoko News aggregates news from 100+ Pan-African sources, providing a unified platform for staying informed about African affairs. Features include:

- **Pan-African Coverage**: 54 AU member states, 100+ news sources
- **TikTok-Style NewsBytes**: Vertical scroll feed for quick news consumption
- **AI-Powered Search**: Semantic search backed by MongoDB Atlas
- **Dark Mode**: Full theme support with system preference detection
- **Schema.org SEO**: JSON-LD structured data for NewsArticle, Organization, BreadcrumbList
- **Embeddable Widgets**: Drop-in news widgets for sister apps
- **MCP Integration**: LLMs can browse Pan-African news at `news.mukoko.com/mcp`

## Three-Repo Architecture

This repository is the **Next.js frontend only**.

| Repo | Contents | Deploys to |
|---|---|---|
| [`nyuchi/mukoko-news`](https://github.com/nyuchi/mukoko-news) | Next.js 15 frontend | Vercel |
| [`nyuchi/mukoko-news-gateway`](https://github.com/nyuchi/mukoko-news-gateway) | Cloudflare Workers API + MCP | Cloudflare Workers |
| [`nyuchi/mukoko-news-pipeline`](https://github.com/nyuchi/mukoko-news-pipeline) | Fly.io pipeline + Cloudflare processing | Fly.io + Cloudflare |

The frontend reads and writes directly to MongoDB Atlas via Next.js Server Actions. It does not call the gateway Worker except for admin mutations.

## Quick Start

### Prerequisites

- Node.js 20+, pnpm 10+
- MongoDB Atlas connection string (for local development with live data)

### Setup

```bash
# Clone and install
git clone https://github.com/nyuchi/mukoko-news.git
cd mukoko-news
pnpm install

# Configure environment
cp .env.example .env.local
# Edit .env.local — see Environment Variables below

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

Create `.env.local`:

```env
# MongoDB Atlas — Server Actions read/write directly
MONGODB_URI=mongodb+srv://<user>:<pass>@nyuchi-platform-doc-db.ge8d8qi.mongodb.net/?appName=nyuchi-platform-doc-db
MONGODB_DATABASE=news

# Leave empty (Server Actions handle all reads via MongoDB)
# Set to Cloudflare Worker URL only for the external widget/resale API
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com

# WorkOS AuthKit
WORKOS_API_KEY=sk_live_...
WORKOS_CLIENT_ID=client_01KV2G41CHGBSH6HG57AQBFKDD
WORKOS_COOKIE_PASSWORD=<32+ char random string>

# Gateway Worker (admin mutations only)
GATEWAY_API_URL=https://news.mukoko.com
```

## Project Structure

```text
mukoko-news/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/
│   │   ├── ui/           # Reusable UI (article-card, json-ld, skeleton, …)
│   │   └── layout/       # Header, footer, bottom-nav
│   ├── contexts/         # PreferencesContext, ThemeContext
│   └── lib/
│       ├── actions/      # Server Actions (feed.ts, refresh.ts, admin/)
│       ├── mongodb/      # MongoDB query helpers (articles, categories, sources)
│       ├── api.ts        # Client-side fetch helper + embed widget
│       ├── constants.ts  # Countries, categories, BASE_URL helpers
│       └── utils.ts      # Formatting, security helpers (safeCssUrl, isValidImageUrl)
├── public/
│   └── embed/            # Embeddable widget script (widget.js)
└── CLAUDE.md             # AI assistant instructions
```

## Commands

```bash
pnpm dev              # Next.js dev server (port 3000)
pnpm build            # Production build
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint auto-fix
pnpm typecheck        # TypeScript check
pnpm test             # Vitest (single run, 448 tests)
pnpm test:watch       # Vitest (watch mode)
pnpm test:coverage    # Vitest with v8 coverage
```

## Architecture

### Frontend Stack

- **Framework**: Next.js 15 with App Router + React 19
- **UI**: Tailwind CSS 4 with CSS variables, Radix UI primitives
- **Icons**: Lucide React, **Theme**: next-themes
- **Data**: MongoDB Atlas via Server Actions (`src/lib/actions/feed.ts`)
- **Auth**: WorkOS AuthKit (`@workos-inc/authkit-nextjs`)
- **State**: React Context (preferences, theme)

### Data Flow

All news data flows through Server Actions → MongoDB Atlas (`news` database):

```
Browser → Next.js Server Action → src/lib/mongodb/*.ts → MongoDB Atlas
```

Admin mutations are the only exception — they route through the gateway Worker (`src/lib/admin/gateway.ts`) with a WorkOS access token.

### Design System (Nyuchi Brand v6)

```js
{
  primary:   '#4B0082',  // Tanzanite
  secondary: '#0047AB',  // Cobalt
  accent:    '#5D4037',  // Gold
  surface:   '#FAF9F5',  // Warm Cream
  fonts: { heading: 'Noto Serif', body: 'Plus Jakarta Sans' }
}
```

CSS variables in `src/app/globals.css`. Tailwind classes: `bg-primary`, `text-foreground`, `bg-surface`.

## Pages

| Path | Description |
|---|---|
| `/` | Personalized feed — Featured + Latest layout |
| `/discover` | Browse by country, category, source |
| `/sources` | All news sources with stats |
| `/newsbytes` | TikTok-style vertical scroll feed |
| `/article/[slug]` | Full article with breadcrumbs and JSON-LD |
| `/search` | Full-text search with filters |
| `/profile` | User settings and preferences |
| `/admin` | Admin dashboard (moderation, sources) |
| `/embed/iframe` | Embeddable widget renderer |

## Embed Widgets

Drop-in news widgets for sister sites (e.g. weather.mukoko.com):

```html
<script src="https://news.mukoko.com/embed/widget.js"
        data-layout="cards"
        data-feed="latest"
        data-country="ZW">
</script>
```

5 layouts (`cards`, `compact`, `hero`, `ticker`, `list`) × 4 feed types (`top`, `featured`, `latest`, `location`).

## MCP Server

Mukoko News exposes a **Model Context Protocol (MCP) server** — hosted in [`nyuchi/mukoko-news-gateway`](https://github.com/nyuchi/mukoko-news-gateway).

**Remote endpoint**: `https://news.mukoko.com/mcp`

```json
{
  "mcpServers": {
    "mukoko-news": {
      "type": "http",
      "url": "https://news.mukoko.com/mcp"
    }
  }
}
```

## Testing

448 tests — Vitest with jsdom environment + React Testing Library.

```bash
pnpm test                                          # All tests
pnpm vitest run src/lib/__tests__/utils.test.ts    # Single file
pnpm vitest run -t "formatTimeAgo"                 # By pattern
```

**Mock pattern for pages**: always mock `@/lib/actions/feed` (Server Actions), not `@/lib/api`.

CI runs on every PR: lint matrix (actionlint, JSON validity, prettier, markdownlint, yamllint) + tests, typecheck, lint, build.

## Deployment

The frontend auto-deploys to Vercel on push to `main`. No manual steps required.

**Live site**: [news.mukoko.com](https://news.mukoko.com)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repo, create a branch: `git checkout -b feature/my-feature`
2. Make changes and run `pnpm lint && pnpm typecheck && pnpm test`
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `feat: add xyz`
4. Push and open a Pull Request against `main`

## Security

Report vulnerabilities to **security@nyuchi.com** — do not open a public GitHub issue. See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE) for details.

---

"Ndiri nekuti tiri" — I am because we are

Built with love by [Nyuchi Technologies](https://nyuchi.com)
