# Mukoko News Backend Worker

Backend API (`mukoko-news-gateway`) for Mukoko News — Pan-African Digital News Aggregation Platform.

## Deployment

The backend deploys automatically via the **Cloudflare GitHub App** on push to `main`. The app is configured in the Cloudflare dashboard with root directory set to `backend/` so it picks up `backend/wrangler.jsonc` directly.

Manual deployment:

```bash
cd backend && npm run deploy
```

Or from root:

```bash
npm run deploy:backend
```

## Development

```bash
# Install dependencies
npm install

# Run development server (port 8787)
npm run dev

# Build (dry run)
npm run build

# Type check
npm run typecheck

# Run tests
npm run test

# Deploy to production
npm run deploy
```

## Configuration

Worker configuration: `backend/wrangler.jsonc`

- **Name**: `mukoko-news-gateway`
- **Routes**: `news.mukoko.com/mcp*`, `news.mukoko.com/api/*`
- **Main**: `index.ts`
- **Compatibility date**: `2025-10-01`

## Architecture

The backend worker handles:

- MCP server (`news.mukoko.com/mcp*`) — LLM tool use for article search and retrieval
- Public widget/resale API (`news.mukoko.com/api/*`) — news feeds, article lookup, categories
- User authentication and authorization (OIDC, Mobile SMS, Web3 wallets)
- Real-time analytics via Durable Objects
- Semantic search via Vectorize

See [CLAUDE.md](../CLAUDE.md) for full architecture documentation.
