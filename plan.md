# Plan: Mukoko News API — Python Worker + MongoDB + Anthropic AI Gateway

## Problem Statement

Three issues with the current backend:

1. **Wrong AI models**: All 13 `ai.run()` calls use `@cf/meta/llama-3-8b-instruct` (Workers AI). We should be using **Anthropic Claude models via Cloudflare AI Gateway**.

2. **Wrong language for data processing**: Heavy processing (RSS parsing, HTML cleaning, article clustering, keyword extraction, content scraping, feed ranking) is hand-rolled TypeScript with fragile regex. Python has mature, battle-tested libraries for all of these.

3. **Wrong primary database**: D1 (SQLite at edge) is great for low-latency reads but not for a primary data store at scale. **MongoDB Atlas** becomes the primary data store; D1 becomes an edge cache for low-bandwidth African markets.

## Target Architecture

```
Vercel (Next.js frontend)
    │
    │ API_SECRET (bearer token)
    ▼
TypeScript Worker (Hono)                Python Worker "mukoko-news-api" (FastAPI)
──────────────────────────              ─────────────────────────────────────────
 HTTP routing, auth, CORS   ──────►     Production: https://news-api.mukoko.com
 Admin endpoints            Service     Dev: https://mukoko-news-api.<acct>.workers.dev
 D1 edge cache reads        Binding
 Rate limiting, CSRF        (internal   RSS parsing (feedparser)
 Durable Objects             RPC)       HTML cleaning (beautifulsoup4)
                                        Content extraction (bs4 CSS selectors)
                                        Keyword extraction (AI Gateway + NLP)
                                        Article clustering (numpy + embeddings)
                                        Quality scoring (textstat)
                                        Semantic search (Vectorize FFI)
                                        Feed ranking (numpy)
                                │
                                ▼
                        Cloudflare AI Gateway
                          provider: anthropic
                          model: claude-sonnet-4-5-20250929
                                │
                        ┌───────┴───────┐
                        ▼               ▼
                MongoDB Atlas       D1 (Edge Cache)
                (Primary DB)        (Low-bandwidth optimization)
                via Data API        via FFI bindings
                                │
                                ▼
                        KV / Vectorize / R2
                        (via Python FFI bindings)
```

Both Workers live in the same repo. The Python Worker has its own `wrangler.jsonc` and `pyproject.toml`.

---

## Data Store Architecture

### MongoDB Atlas (Primary)

All authoritative data lives in MongoDB, accessed via the Atlas Data API (HTTP-based, no TCP driver needed — works perfectly in Cloudflare Workers / Pyodide).

**Collections**: articles, categories, keywords, news_sources, rss_sources, users, user_interactions, countries, author_profiles

**Why MongoDB**:
- Document model fits news articles naturally (nested content, metadata, images)
- Atlas Data API is HTTP-based (compatible with Workers runtime)
- Aggregation pipeline for complex queries (trending, analytics, clustering)
- Horizontal scaling for growing Pan-African content
- Full-text search capabilities

**Client**: `processing/services/mongodb.py` — `MongoDBClient` class with full CRUD + aggregation

### D1 (Edge Cache)

D1 remains as an edge cache for low-bandwidth optimization in African markets:

- **Binding**: `EDGE_CACHE_DB` (renamed from `DB` to make the role clear)
- **Purpose**: Fast reads for frequently-accessed articles, keywords, categories
- **Sync**: Hourly cron job syncs from MongoDB → D1
- **Fallback**: Search and keyword lookups fall back to D1 when MongoDB is unreachable

### Secrets Required

```bash
# MongoDB Atlas Data API
uv run pywrangler secret put MONGODB_API_KEY       # Data API key
uv run pywrangler secret put MONGODB_APP_ID        # Atlas App Services app ID

# Anthropic
uv run pywrangler secret put ANTHROPIC_API_KEY     # Anthropic API key
```

---

## Part 1: AI Model Migration (Anthropic via AI Gateway)

### What Changes

Every `this.ai.run('@cf/meta/llama-3-8b-instruct', ...)` call gets replaced with Anthropic Claude via AI Gateway.

**Current (wrong):**
```typescript
const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
  prompt: "Extract keywords from this article..."
});
```

**Target (correct):**
```python
# Python Worker — calling Anthropic via AI Gateway FFI
gateway = self.env.AI.gateway("mukoko-gateway")
result = await gateway.run([{
    "provider": "anthropic",
    "endpoint": "messages",
    "headers": {"x-api-key": self.env.ANTHROPIC_API_KEY},
    "query": {
        "model": "claude-sonnet-4-5-20250929",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}]
    }
}])
```

### Affected Calls (13 total)

| File | Line | Current Model | Purpose |
|------|------|---------------|---------|
| `ArticleAIService.ts` | 188 | `llama-3-8b-instruct` | Content cleaning (AI fallback) |
| `ArticleAIService.ts` | 274 | `llama-3-8b-instruct` | Keyword extraction |
| `ArticleAIService.ts` | 356 | `llama-3-8b-instruct` | Quality scoring |
| `ArticleAIService.ts` | 439 | `baai/bge-base-en-v1.5` | Embedding generation (keep for Vectorize) |
| `ArticleAIService.ts` | 540 | `llama-3-8b-instruct` | Default AI model param |
| `ArticleAIService.ts` | 624 | `llama-3-8b-instruct` | Author extraction |
| `ArticleAIService.ts` | 700 | `llama-3-8b-instruct` | Content classification |
| `ArticleAIService.ts` | 794 | `llama-3-8b-instruct` | Additional processing |
| `ArticleAIService.ts` | 857 | `llama-3-8b-instruct` | Grammar assessment |
| `ArticleAIService.ts` | 897 | `llama-3-8b-instruct` | Additional processing |
| `ArticleAIService.ts` | 935 | `llama-3-8b-instruct` | Additional processing |
| `AISearchService.ts` | 198 | `llama-3.1-8b-instruct` | Trending topic extraction |
| `AISearchService.ts` | 233 | `llama-3.1-8b-instruct` | AI insights generation |
| `AISearchService.ts` | 315 | `baai/bge-base-en-v1.5` | Search embedding (keep for Vectorize) |

**Note**: The 2 `baai/bge-base-en-v1.5` calls stay as Workers AI (Vectorize compatibility). Everything else moves to Anthropic.

### AI Gateway Setup

Create gateway `mukoko-gateway` in Cloudflare dashboard (AI > AI Gateway):
```jsonc
"ai": {
    "binding": "AI"
}
```

The gateway provides: request caching, rate limiting, logging, cost tracking, and provider fallback.

---

## Part 2: Python Worker — mukoko-news-api

### Worker Identity

- **Name**: `mukoko-news-api`
- **Production URL**: `https://news-api.mukoko.com`
- **Workers Dev URL**: `https://mukoko-news-api.<account>.workers.dev`
- **Staging URL**: `https://staging-news-api.mukoko.com`
- **Service Binding**: `DATA_PROCESSOR` → calls via `http://news-api/...`

### Why Python

| Task | Current TS Approach | Python Replacement | Improvement |
|------|--------------------|--------------------|-------------|
| RSS parsing | `fast-xml-parser` + custom logic (943 lines) | `feedparser` (battle-tested) | 50% less code, spec-compliant |
| HTML cleaning | 3-pass regex loops, manual entity map | `beautifulsoup4` (DOM-aware) | Handles malformed HTML |
| Image extraction | 8 separate regex patterns | `bs4` CSS selectors | Real CSS selectors |
| Content scraping | 10+ regex patterns | `bs4` CSS selectors | Real DOM queries |
| Keyword extraction | Substring matching, AI-only | AI Gateway + text analysis | Better confidence scoring |
| Quality scoring | AI prompt + fixed heuristics | `textstat` readability + AI | Deterministic metrics |
| Article clustering | Jaccard O(n^2), English-only | `numpy` vectorized + AI embeddings | Semantic, multilingual |
| Feed ranking | Loop-based fixed weights | `numpy` vectorized scoring | Faster, cleaner math |

### File Structure

```
processing/                              # Python News API Worker
├── src/
│   └── entry.py                         # FastAPI entrypoint (WorkerEntrypoint)
├── services/
│   ├── __init__.py
│   ├── ai_client.py                     # Anthropic via AI Gateway wrapper
│   ├── mongodb.py                       # MongoDB Atlas Data API client
│   ├── rss_parser.py                    # feedparser + bs4
│   ├── content_cleaner.py               # bs4 HTML cleaning
│   ├── content_extractor.py             # bs4 web scraping
│   ├── keyword_extractor.py             # AI Gateway + edge cache keywords
│   ├── quality_scorer.py                # textstat + heuristics
│   ├── clustering.py                    # numpy + AI embeddings
│   ├── search_processor.py              # Vectorize FFI + edge cache
│   ├── feed_ranker.py                   # numpy vectorized ranking
│   └── router.py                        # Request dispatcher
├── tests/
│   ├── __init__.py
│   ├── test_rss_parser.py
│   ├── test_content_cleaner.py
│   ├── test_quality_scorer.py
│   ├── test_clustering.py
│   ├── test_feed_ranker.py
│   └── test_content_extractor.py
├── pyproject.toml                       # Dependencies
└── wrangler.jsonc                       # Python Worker config
```

### Python Worker Config (`processing/wrangler.jsonc`)

Key configuration:
- Custom domain: `news-api.mukoko.com`
- D1 binding renamed to `EDGE_CACHE_DB` (edge cache role)
- MongoDB env vars: `MONGODB_CLUSTER`, `MONGODB_DATABASE`, `MONGODB_DATA_API_URL`
- Workers dev URL enabled
- Analytics Engine datasets: `API_ANALYTICS`, `SEARCH_ANALYTICS`, `AI_ANALYTICS`
- Cron triggers: RSS (15min), edge sync (hourly), trending (30min), health (6hr)
- Staging and dev environments with separate MongoDB databases
- Full observability with `head_sampling_rate: 1`

### Main Worker Service Binding (`backend/wrangler.jsonc`)

```jsonc
"services": [{
    "binding": "DATA_PROCESSOR",
    "service": "mukoko-news-api"
}]
```

### How the Main Worker Calls the Python Worker

```typescript
// backend/services/ProcessingClient.ts
const client = new ProcessingClient(env.DATA_PROCESSOR);

// RSS parsing
const result = await client.parseRSS(feedXml, source);

// Full article processing pipeline
const processed = await client.processArticle({
  id: 1, title: "...", content: "..."
});

// Semantic search
const results = await client.search("Zimbabwe economy", { limit: 20 });

// Service Binding URL: http://news-api/...
```

---

## Part 3: Service-by-Service Migration Details

### 3a. RSS Parsing (`SimpleRSSService` → `rss_parser.py`)

**What this eliminates:**
- 8 regex image extraction methods → `feedparser` built-in + 1 `bs4` fallback
- `fast-xml-parser` + custom RSS/Atom handling → `feedparser` handles all formats
- Manual entity decoding → `bs4` handles automatically
- 3-pass regex HTML removal → `bs4.decompose()` + `get_text()`

### 3b. Content Cleaning (`ArticleAIService.cleanContent` → `content_cleaner.py`)

**What this eliminates:**
- do-while regex loops → `soup.decompose()`
- 4 image regex patterns → `soup.find_all('img')`
- Manual entity map → bs4 handles automatically
- AI fallback for cleaning → not needed, bs4 handles malformed HTML

### 3c. AI Processing (`ArticleAIService` → `article_ai.py` + `ai_client.py`)

**Benefits of Claude over Llama-3-8b:**
- Keyword extraction: Claude follows JSON format reliably (no malformed JSON)
- Quality scoring: Claude provides calibrated 0-1 scores
- Author extraction: Claude handles complex bylines accurately
- Content classification: Claude distinguishes news vs opinion vs analysis

### 3d. Clustering (`StoryClusteringService` → `clustering.py`)

**What this improves:**
- Semantic similarity instead of word overlap ("economy" and "business" now match)
- Multilingual stopwords (Shona, Swahili, French, Portuguese, Arabic — not just English)
- Vectorized numpy operations instead of nested JS loops
- Cosine similarity on embeddings vs Jaccard on word sets

### 3e. Quality Scoring (`ArticleAIService.assessQuality` → `quality_scorer.py`)

**What this improves:**
- Deterministic scoring (no AI call needed for basic quality)
- Reproducible results (same article always gets same score)
- Instant response (no AI latency)

### 3f. MongoDB Integration (`mongodb.py`)

**MongoDB Atlas Data API client** for the Python Worker:
- HTTP-based (no TCP driver — works in Pyodide/Workers)
- Full CRUD: `find`, `find_one`, `insert_one`, `update_one`, `delete_one`
- Aggregation pipeline support
- JS fetch via FFI transport layer
- Endpoint pattern: `{base_url}/{app_id}/endpoint/data/v1/action/{action}`

---

## Part 4: Migration Order

Incremental migration, not big-bang. Each step is independently deployable.

| Phase | Service | Risk | Reason for Order |
|-------|---------|------|-----------------|
| **1** | RSS Parser | Low | Most self-contained, `feedparser` is rock-solid |
| **2** | Content Cleaner | Low | Pure text processing, easy to verify parity |
| **3** | Quality Scorer | Low | `textstat` is deterministic, easy to compare |
| **4** | Keyword Extractor | Medium | Switches to Anthropic AI, needs prompt tuning |
| **5** | Content Extractor | Medium | Web scraping, depends on package availability |
| **6** | Clustering | Medium | Needs AI embeddings + numpy, more complex |
| **7** | Search Processor | Medium | Touches Vectorize, needs integration testing |
| **8** | Feed Ranker | Low | Pure math, numpy replacement |
| **9** | MongoDB Migration | High | Data migration from D1 → MongoDB Atlas |

**For phases 1-8:**
1. Implement Python service with tests
2. Add router endpoint
3. Update TS service to call Python Worker via Service Binding
4. Keep TS fallback: if Python Worker call fails, fall back to existing TS logic
5. Deploy and monitor
6. Remove TS fallback once stable

**For phase 9 (MongoDB):**
1. Set up MongoDB Atlas cluster and Data API
2. Create collections matching D1 schema
3. Migrate data from D1 → MongoDB
4. Switch Python services to read/write MongoDB as primary
5. Keep D1 as read-only edge cache, synced hourly
6. Update backend TS Worker D1 queries to be cache reads only

---

## Part 5: Commands and CI/CD

### New Commands (root `package.json`)

```json
{
    "dev:api": "cd processing && uv run pywrangler dev",
    "deploy:api": "cd processing && uv run pywrangler deploy",
    "test:api": "cd processing && uv run pytest",
    "typecheck:api": "cd processing && uv run pyright"
}
```

### Development Workflow

```bash
# Terminal 1: Main TS Worker
cd backend && npm run dev          # port 8787

# Terminal 2: Python News API Worker
cd processing && uv run pywrangler dev  # separate port

# Terminal 3: Next.js frontend
npm run dev                         # port 3000
```

### CI/CD Updates (`.github/workflows/deploy.yml`)

Add steps:
1. Install `uv` and Python 3.12
2. `cd processing && uv run pytest` (Python tests)
3. `cd processing && uv run pywrangler deploy` (deploy Python Worker)
4. Health check on Python Worker (`https://news-api.mukoko.com/health`)
5. Then deploy TS Worker (which has Service Binding to Python Worker)

**Deploy order matters**: Python Worker must deploy before TS Worker, since the Service Binding references it.

### New Secrets

```bash
# MongoDB Atlas Data API
uv run pywrangler secret put MONGODB_API_KEY
uv run pywrangler secret put MONGODB_APP_ID

# Anthropic API key for AI Gateway
uv run pywrangler secret put ANTHROPIC_API_KEY

# Staging environment
uv run pywrangler secret put MONGODB_API_KEY --env staging
uv run pywrangler secret put MONGODB_APP_ID --env staging
uv run pywrangler secret put ANTHROPIC_API_KEY --env staging
```

---

## Part 6: What Stays in TypeScript

These services remain in the Hono Worker — they're lightweight or tied to Workers-specific features:

| Service | Reason to Keep in TS |
|---------|---------------------|
| `D1Service` / `D1CacheService` | Edge cache reads, simple CRUD |
| `D1UserService` | User database operations (will migrate to MongoDB later) |
| `AuthProviderService` | Auth logic, session management |
| `OIDCAuthService` | OIDC token validation |
| `RateLimitService` | KV-based rate limiting |
| `CSRFService` | Request validation |
| `ObservabilityService` | Logging |
| `CloudflareImagesService` | Images API binding |
| `AnalyticsEngineService` | Analytics datasets |
| `CountryService` | Edge cache reads |
| `CategoryManager` | Edge cache reads |
| `NewsSourceManager` | Edge cache reads |
| All Durable Objects | Workers runtime feature |

---

## Part 7: Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Python Workers beta instability | Medium | Keep TS fallbacks during migration |
| Package not in Pyodide | Medium | Verify each dep; request via GitHub if missing |
| Service Binding latency | Low | Internal RPC is ~1ms, not HTTP |
| AI Gateway/Anthropic costs | Low | Gateway caching; Claude is more efficient per-call |
| Pyodide cold start | Medium | Memory snapshots mitigate; monitor P95 latency |
| MongoDB Atlas Data API latency | Low | Smart Placement co-locates; D1 edge cache for reads |
| MongoDB Atlas availability | Low | D1 edge cache serves reads if MongoDB is down |
| Data migration risk | Medium | Run D1 and MongoDB in parallel during transition |

---

## Part 8: Verification Checklist

Before removing each TS fallback:

- [ ] Python service returns identical response shape to TS service
- [ ] Python tests cover all edge cases from existing TS tests
- [ ] Latency P50/P95 within 20% of TS implementation
- [ ] Error rates equal or lower
- [ ] AI Gateway logs confirm Anthropic calls succeed
- [ ] No regressions in frontend behavior
- [ ] Backend test suite still passes (548 tests)
- [ ] Frontend test suite still passes (437 tests)

Before MongoDB go-live:

- [ ] All collections created with correct indexes
- [ ] Data migrated from D1 to MongoDB (articles, sources, keywords, categories, users)
- [ ] Edge cache sync cron job tested and working
- [ ] MongoDB Atlas monitoring and alerts configured
- [ ] Fallback to D1 edge cache tested for MongoDB downtime scenarios
- [ ] MONGODB_API_KEY and MONGODB_APP_ID secrets set for production, staging, dev
