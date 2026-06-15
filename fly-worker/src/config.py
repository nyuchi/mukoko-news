"""Pipeline configuration — loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Fly.io pipeline settings. All secrets set via `fly secrets set`."""

    # MongoDB connection — single URI, multiple databases on the cluster
    mongodb_uri: str = ""

    # Named database configs — each domain has its own MongoDB database
    mongodb_news_db: str = "news"
    mongodb_engagement_db: str = "engagement"
    mongodb_entity_db: str = "entity"
    mongodb_platform_db: str = "platform"

    # Newsdata.io — article ingestion and source discovery
    newsdata_api_key: str = ""

    # AI services — article enrichment
    anthropic_api_key: str = ""

    # Cloudflare Workers AI — BGE-M3 embeddings
    cf_account_id: str = ""
    cf_ai_api_token: str = ""

    # RSS collection
    rss_fetch_timeout: int = 15
    rss_batch_size: int = 10
    rss_max_articles_per_source: int = 20

    # Worker
    log_level: str = "info"
    environment: str = "production"

    # Gateway URL — for triggering Cloudflare processing pipeline
    gateway_url: str = "https://news.mukoko.com"
    gateway_internal_token: str = ""   # API_SECRET for internal endpoints

    # fundi-news-enrichment — AI enrichment agent (Cloudflare Worker)
    fundi_enrichment_url: str = ""     # e.g. https://fundi-news-enrichment.workers.dev
    fundi_enrichment_token: str = ""   # ENRICHMENT_API_TOKEN

    # On-demand trigger — protects POST /trigger/collect (called by Next.js pull-to-refresh)
    fly_trigger_token: str = ""

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
