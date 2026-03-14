"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Fly.io worker settings. All secrets set via `fly secrets set`."""

    # Fly.io Managed Postgres (DATABASE_URL is auto-set by Fly.io)
    database_url: str = "postgresql://localhost:5432/mukoko_news"

    # AI services
    anthropic_api_key: str = ""
    voyage_api_key: str = ""

    # D1 sync target (Cloudflare Worker URL that proxies D1 writes)
    d1_sync_url: str = ""
    d1_sync_secret: str = ""

    # Worker config
    log_level: str = "info"
    environment: str = "production"

    # RSS collection
    rss_fetch_timeout: int = 15
    rss_batch_size: int = 10
    rss_max_articles_per_source: int = 20

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
