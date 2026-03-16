"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Fly.io worker settings. All secrets set via `fly secrets set`."""

    # Database — Supabase direct connection
    database_url: str = "postgresql://localhost:5432/mukoko_news"

    # AI services
    anthropic_api_key: str = ""
    voyage_api_key: str = ""

    # API authentication
    api_secret: str = ""  # Bearer token for frontend-to-backend auth
    admin_session_secret: str = ""  # Admin dashboard auth

    # OIDC (id.mukoko.com)
    oidc_issuer_url: str = "https://id.mukoko.com"
    oidc_client_secret: str = ""

    # CORS
    cors_origins: str = "https://news.mukoko.com,https://mukoko-news.vercel.app,http://localhost:3000"

    # Worker config
    log_level: str = "info"
    environment: str = "production"

    # RSS collection
    rss_fetch_timeout: int = 15
    rss_batch_size: int = 10
    rss_max_articles_per_source: int = 20

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
