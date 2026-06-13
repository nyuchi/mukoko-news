-- ══════════════════════════════════════════════════
-- Migration 004: pgvector embeddings for semantic search
-- Model: BAAI/bge-m3 via Cloudflare Workers AI (1024 dimensions)
-- ══════════════════════════════════════════════════

-- Enable pgvector extension (Supabase has this pre-installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column for BGE-M3 embeddings (1024 dimensions)
ALTER TABLE news.news_article
    ADD COLUMN IF NOT EXISTS embedding_vector vector(1024);

-- HNSW index for fast approximate nearest neighbor search
-- ef_construction=128: build quality (higher = better recall, slower build)
-- m=16: connections per node (higher = better recall, more memory)
CREATE INDEX IF NOT EXISTS idx_news_article_embedding_hnsw
    ON news.news_article
    USING hnsw (embedding_vector vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);

-- Track when embedding was generated (separate from ai_processed)
ALTER TABLE news.news_article
    ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- Partial index: find articles that need embedding
CREATE INDEX IF NOT EXISTS idx_news_article_needs_embedding
    ON news.news_article (ai_processed, datepublished DESC)
    WHERE embedding_vector IS NULL AND ai_processed = TRUE;
