# Mukoko News Backend Worker

Backend API and Admin Interface for Mukoko News - Pan-African Digital News Aggregation Platform.

## Deployment

**⚠️ IMPORTANT: Backend deployments are manual only.**

The backend worker does NOT use Cloudflare Workers CI/CD because:
- The CI system builds from the root directory (designed for frontend)
- This causes config conflicts between frontend and backend workers

### Manual Deployment

To deploy the backend worker:

```bash
# From the backend directory
cd backend
npm run deploy
```

Or from the root directory:

```bash
# Use the backend deploy script
cd backend && npm run deploy
```

### Why Manual Deployment?

The Cloudflare Workers CI/CD for `mukoko-news-backend` is **disabled** because:

1. The repository root contains the frontend (Next.js) application
2. CI runs `npm run build` which builds the frontend, not the backend
3. This creates a config mismatch where frontend config tries to deploy to backend worker

### Deployment Workflow

```
Local Development
    ↓
Code Changes (backend/)
    ↓
Test Locally (npm run dev)
    ↓
Manual Deploy (npm run deploy)
    ↓
Production (mukoko-news-api.fly.dev)
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build (dry run)
npm run build

# Type check
npm run typecheck

# Deploy to production
npm run deploy
```

## Configuration

Worker configuration: `backend/wrangler.jsonc`

- **Name**: mukoko-news-backend
- **Route**: mukoko-news-api.fly.dev/*
- **Main**: index.ts

## Architecture

The backend worker handles:
- Admin dashboard UI
- RSS feed processing
- AI content enhancement
- User authentication and authorization
- Analytics and insights
- News source management

See [CLAUDE.md](../CLAUDE.md) for full architecture documentation.
