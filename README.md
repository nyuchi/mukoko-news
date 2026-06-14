# Mukoko News

> **Africa's Digital News Aggregation Platform**

"Mukoko" means "Beehive" in Shona - where community gathers and stores knowledge. A modern Pan-African news platform built with Next.js and Cloudflare Workers.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Overview

Mukoko News aggregates news from 56+ Pan-African sources across 16 countries, providing a unified platform for staying informed about African affairs. Features include:

- **TikTok-Style NewsBytes**: Vertical scroll feed for quick news consumption
- **Pan-African Coverage**: News from Zimbabwe, South Africa, Kenya, Nigeria, Ghana, and 11 more countries
- **AI-Powered**: Workers AI for content processing and semantic search
- **Real-Time Analytics**: Durable Objects for live engagement tracking
- **Dark Mode Support**: Full theme support with system preference detection
- **Schema.org SEO**: JSON-LD structured data for NewsArticle, Organization, BreadcrumbList
- **Mobile Bottom Navigation**: Easy access to key sections on mobile devices

## Project Structure

```text
mukoko-news/
├── src/              # Next.js frontend
│   ├── app/          # App Router pages
│   ├── components/   # React components
│   │   ├── ui/       # Reusable UI (json-ld, breadcrumb, skeleton)
│   │   └── layout/   # Layout components (header, footer, bottom-nav)
│   ├── contexts/     # React contexts (preferences, theme)
│   └── lib/          # Utilities, API client, constants
├── backend/          # Cloudflare Workers API (Hono framework, mukoko-news-gateway)
├── fly-worker/       # Fly.io Python pipeline (RSS ingest, AI enrichment, MongoDB writes)
├── processing/       # Cloudflare Python edge processor (service binding from backend)
├── image-worker/     # Cloudflare image optimisation worker (assets.mukoko.com)
├── mcp-package/      # @nyuchi/mukoko-news-mcp — published to npm + MCP Registry
├── database/         # D1 schema and migrations
├── public/           # Static assets
└── CLAUDE.md         # AI assistant instructions
```

## Quick Start

### Prerequisites

- Node.js 20+, pnpm 10+
- Python 3.12+, [uv](https://docs.astral.sh/uv/) (Python package manager)
- Cloudflare account (for backend/processing workers)
- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) (for fly-worker pipeline)

### Frontend Setup (Next.js)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck
```

### Backend Setup

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Apply database schema locally
npm run db:local

# Start development server
npm run dev

# Deploy to Cloudflare
npm run deploy
```

### Environment Variables

Create `.env.local` in the root directory:

```env
NEXT_PUBLIC_API_URL=https://mukoko-news-backend.nyuchi.workers.dev
NEXT_PUBLIC_BASE_URL=https://news.mukoko.com  # Optional: Base URL for SEO/JSON-LD
EXPO_PUBLIC_API_SECRET=your_api_secret_here
```

## Architecture

### Frontend Stack

- **Framework**: Next.js 15 with App Router
- **UI**: Tailwind CSS 4 with custom design system
- **Components**: Radix UI primitives
- **Icons**: Lucide React
- **Theme**: next-themes for dark mode support
- **TypeScript**: Full type safety

### Backend Stack

- **Runtime**: Cloudflare Workers (edge computing)
- **Framework**: Hono (lightweight, ~12KB)
- **Database**: D1 (SQLite at edge) + MongoDB Atlas (primary data store)
- **Cache**: KV Namespaces
- **Real-time**: Durable Objects (4 classes)
- **AI**: Workers AI for content processing
- **Search**: Vectorize for semantic search
- **Auth**: OIDC via id.mukoko.com

### Pipeline Worker Stack

- **Runtime**: Fly.io (Johannesburg, JNB) — persistent FastAPI + APScheduler process
- **Database**: MongoDB Atlas via Motor async driver (~30 databases: news, engagement, entity, platform)
- **AI**: Anthropic Claude for NLP enrichment + Cloudflare Workers AI for BGE-M3 embeddings
- **Jobs**: RSS ingestion, AI enrichment, engagement aggregation, source health, trending, embeddings

### Design System (Nyuchi Brand v6)

```javascript
{
  primary: '#4B0082',    // Tanzanite
  secondary: '#0047AB',  // Cobalt
  accent: '#5D4037',     // Gold
  surface: '#FAF9F5',    // Warm Cream (light mode)
  fonts: {
    heading: 'Noto Serif',
    body: 'Plus Jakarta Sans'
  }
}
```

## API

**Base URL**: `https://mukoko-news-backend.nyuchi.workers.dev`

### Public Endpoints (Require API Key)

```bash
# Get articles feed
GET /api/feeds?limit=20&category=politics&countries=ZW,SA

# Get article by ID
GET /api/article/:id

# Get categories
GET /api/categories

# Get countries
GET /api/countries

# Health check (no auth required)
GET /api/health
```

### Admin Endpoints (Require Admin Role)

```bash
GET /api/admin/stats
GET /api/admin/users
GET /api/admin/sources
GET /api/admin/analytics
```

Full API documentation: [api-schema.yml](api-schema.yml)

## Common Commands

### Frontend

```bash
npm run dev          # Start Next.js dev server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run typecheck    # TypeScript check
npm run clean        # Clean build artifacts
```

### Backend

```bash
cd backend
npm run dev          # wrangler dev (local worker)
npm run deploy       # Deploy to Cloudflare Workers
npm run test         # vitest run
npm run test:watch   # vitest (watch mode)
npm run typecheck    # tsc --noEmit
npm run db:migrate   # Apply schema to remote D1
npm run db:local     # Apply schema to local D1
```

## Features

### Core Features

- **Responsive Design**: Mobile-first, works on all devices
- **Simplified Feed Layout**: Featured article + Latest articles grid
- **TikTok-Style NewsBytes**: Vertical scroll news feed with snap scrolling
- **Mobile Bottom Navigation**: Quick access to Home, Discover, NewsBytes, Search, Profile
- **Schema.org SEO**: JSON-LD structured data (NewsArticle, Organization, Breadcrumb)
- **Breadcrumb Navigation**: Clear navigation hierarchy on article pages
- **Real-Time Engagement**: Live likes, saves, and views
- **AI-Powered Search**: Semantic search with Vectorize
- **Pan-African Coverage**: 16 countries, 56+ news sources
- **Country-Filtered Feed**: Personalized news based on selected countries
- **Dark Mode**: Full theme support with system detection
- **Skeleton Loaders**: Graceful loading states across all pages
- **Error Boundaries**: Graceful error handling with fallback UI

### Pages

- **Feed** (`/`) - Personalized news feed with Featured + Latest layout
- **Discover** (`/discover`) - Browse by country, category, source, or trending topics
- **NewsBytes** (`/newsbytes`) - TikTok-style vertical swipeable feed
- **Article** (`/article/[id]`) - Full article view with breadcrumbs and JSON-LD
- **Search** (`/search`) - Search articles with category filters
- **Profile** (`/profile`) - User settings and preferences
- **Admin** (`/admin`) - Dashboard for analytics, sources, users

## Testing

### Frontend Tests

```bash
npm run test         # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # With coverage
```

**Test Files** (131 tests total):
- `src/lib/__tests__/utils.test.ts` - Utility functions + CSS injection & XSS attack vector tests
- `src/lib/__tests__/constants.test.ts` - Constants, URL helpers, path traversal & injection tests
- `src/components/__tests__/json-ld.test.tsx` - JSON-LD XSS prevention + expanded injection payloads
- `src/components/__tests__/breadcrumb.test.tsx` - Breadcrumb navigation tests
- `src/components/__tests__/bottom-nav.test.tsx` - Mobile bottom navigation + routing tests
- `src/components/__tests__/hero-card.test.tsx` - HeroCard component tests
- `src/components/__tests__/compact-card.test.tsx` - CompactCard component tests
- `src/components/__tests__/error-boundary.test.tsx` - ErrorBoundary tests

**Test Framework**: Vitest with jsdom environment

### Backend Tests

```bash
cd backend
npm run test         # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # With coverage
```

**Test Framework**: Vitest (10s timeout per test)

## Deployment

### Frontend (Vercel)

The Next.js frontend auto-deploys to Vercel on push to main.

**URL**: `https://news.mukoko.com`

### Backend (Cloudflare Workers)

Deployed automatically by the Cloudflare GitHub App on push to main. Manual:

```bash
cd backend && npm run deploy
```

### Pipeline Worker (Fly.io)

Deployed automatically by CI on push to main (`deploy-fly-worker` job, requires `FLY_API_TOKEN` secret). Manual:

```bash
cd fly-worker && flyctl deploy --remote-only
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes and test
4. Run pre-commit checks: `npm run lint && npm run typecheck`
5. Commit with conventional commits: `feat: Add new feature`
6. Push and create a Pull Request

### Code Style

- ESLint configuration: Flat config (ESLint 9)
- Pre-commit hooks: TypeScript check + Build validation
- Commit format: Conventional Commits

## Documentation

- [CLAUDE.md](CLAUDE.md) - AI assistant instructions
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [SECURITY.md](SECURITY.md) - Security policy
- [api-schema.yml](api-schema.yml) - OpenAPI specification

## License

MIT License - see [LICENSE](LICENSE) for details

## About Mukoko

"Ndiri nekuti tiri" — I am because we are

Mukoko ("Beehive" in Shona) represents the collective knowledge and community of Africa. Just as bees work together to create something greater than themselves, Mukoko News brings together voices from across the continent to inform and empower African communities.

## Codebase Stats

| Area | Lines of Code |
|------|--------------|
| Frontend (`src/`) | ~15,000 |
| Backend (`backend/`) | ~38,200 |
| Pipeline Worker (`fly-worker/`) | ~2,500 |
| Processing Worker (`processing/`) | ~3,200 |
| Database (`database/`) | ~6,900 |
| **Total** | **~65,800** |

Tests: 985+ total (437 frontend + 548 backend + fly-worker pytest)

---

Built with love by [Nyuchi Technologies](https://brand.nyuchi.com)
