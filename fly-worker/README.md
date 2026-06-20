# Mukoko News Pipeline Worker

Background data pipeline deployed on **Fly.io** (`mukoko-news-api`, Johannesburg `jnb` region).

This is a **pure pipeline worker** — not a user-facing API. It ingests news, enriches articles with AI, and writes to MongoDB. The Next.js frontend reads directly from MongoDB.

## Architecture

- **FastAPI** + **uvicorn** for the HTTP process
- **APScheduler** for scheduled background jobs
- **Motor** (async pymongo) for MongoDB Atlas access
- **Anthropic Claude** for NLP article enrichment
- **Cloudflare Workers AI** (BGE-M3) for vector embeddings

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Fly.io health check — reports MongoDB status + scheduled jobs |
| `POST /trigger/collect` | On-demand RSS collection (rate-limited: 3 calls/min) |

No authentication on either endpoint — `/trigger/collect` is rate-limited only.

## Scheduled Jobs

| Job | Schedule | Description |
|---|---|---|
| `rss_collector` | Every 15 min | Fetch all active RSS/Atom feeds → `news.articles` |
| `newsdata_collector` | Every 6 h at :30 | newsdata.io API ingestion for 16 African countries |
| `ai_processor` | Every 30 min | AI enrichment pipeline (Claude NLP, keywords, quality) |
| `engagement` | Every hour | Aggregate engagement scores → `news.articles.bundu` |
| `health_checker` | Every 30 min | Source health monitoring → `news.feedSources` |
| `trending` | Every hour | Trending topics + story clustering |
| `embedding_backfill` | Every 6 h | BGE-M3 vector embedding backfill |
| `cleanup` | Daily at 2am | Stale data pruning |

## MongoDB Databases

| Accessor | Database | Collections |
|---|---|---|
| `get_news_db()` | `news` | `articles`, `feedSources`, `sourceDiscoveryCandidates` |
| `get_engagement_db()` | `engagement` | `aggregateContributions`, `aggregateDefinitions` |
| `get_entity_db()` | `entity` | — |
| `get_platform_db()` | `platform` | `serviceHealth` |

## Development

```bash
# Install dependencies (including dev)
cd fly-worker
uv sync --extra dev

# Run tests
uv run pytest

# Run a single test file
uv run pytest tests/test_engagement.py

# Run tests matching a pattern
uv run pytest -k "test_updates_article"

# Type check
uv run pyright
```

## Deployment

**Automatic**: CI deploys on push to `main` via `deploy-fly-worker` job (requires `FLY_API_TOKEN` secret).

**Manual**:
```bash
cd fly-worker
flyctl deploy --remote-only
```

**Health check** after deploy:
```bash
curl https://news-ingestion.fly-worker.nyuchi.dev/health
# → {"status":"healthy","mongodb":"connected","jobs":{...}}
```

## Fly.io Secrets

```bash
# Run from fly-worker/ directory
flyctl secrets set MONGODB_URI="mongodb+srv://..."
flyctl secrets set ANTHROPIC_API_KEY="..."
flyctl secrets set CF_ACCOUNT_ID="..."
flyctl secrets set CF_AI_API_TOKEN="..."
flyctl secrets set NEWSDATA_API_KEY="..."
```

Optional (override database names):
```bash
flyctl secrets set MONGODB_NEWS_DB=news
flyctl secrets set MONGODB_ENGAGEMENT_DB=engagement
flyctl secrets set MONGODB_ENTITY_DB=entity
flyctl secrets set MONGODB_PLATFORM_DB=platform
```

## Source Discovery Flow

The `newsdata_collector` pulls articles for 16 African countries. For each unknown source it probes 9 common RSS paths. If found, an active `feedSource` is created and picked up by the RSS collector on its next run. If not, an inactive placeholder is created so newsdata continues supplying articles. All candidates are logged in `news.sourceDiscoveryCandidates`.
