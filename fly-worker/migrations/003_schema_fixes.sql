-- Phase 1: Fix schema mismatches
-- Adds missing columns to feed_source that the application code expects

ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS area_served TEXT;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS article_section_id UUID REFERENCES engagement.interest_category(id);
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS total_fetch_count INTEGER DEFAULT 0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS total_error_count INTEGER DEFAULT 0;
ALTER TABLE news.feed_source ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'unknown';
