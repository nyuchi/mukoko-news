"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Fly.io worker settings. All secrets set via `fly secrets set`."""

    # Database — Supabase direct connection
    database_url: str = "postgresql://localhost:5432/mukoko_news"

    # AI services
    anthropic_api_key: str = ""

    # Cloudflare Workers AI — BGE-M3 embeddings
    cf_account_id: str = ""
    cf_ai_api_token: str = ""

    # CouchDB — article body document store
    couchdb_url: str = ""
    couchdb_username: str = ""
    couchdb_password: str = ""
    couchdb_database: str = "mukoko_articles"

    # Apache Doris — analytics and search
    doris_http_url: str = ""
    doris_username: str = ""
    doris_password: str = ""
    doris_database: str = "mukoko_analytics"

    # Authentication — Stytch OTP + Platform JWT
    stytch_project_id: str = ""
    stytch_secret: str = ""
    platform_jwt_secret: str = ""
    platform_api_url: str = "http://mukoko-platform-api.internal:8080"

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
