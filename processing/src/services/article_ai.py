"""
Full article AI processing pipeline — writes results to MongoDB.

Orchestrates: content cleaning → keyword extraction → quality scoring →
content hashing → embedding generation → MongoDB persistence.

Called via Service Binding:
  env.DATA_PROCESSOR.fetch("http://news-api/content/process", {...})
"""

import hashlib
import time

from services.content_cleaner import clean_html_content
from services.keyword_extractor import extract_keywords
from services.quality_scorer import score_quality
from services.ai_client import get_embedding
from services.mongodb import MongoDBClient


async def process_article(article: dict, env=None) -> dict:
    """
    Full AI processing pipeline for a single article.

    Args:
        article: {
            "id": int,
            "title": str,
            "content": str,
            "description": str (optional),
            "category": str (optional),
        }
        env: Cloudflare env bindings

    Returns:
        {
            "cleaned_content": str,
            "extracted_images": list[str],
            "keywords": list[{"keyword", "confidence", "category"}],
            "quality_score": float,
            "content_hash": str,
            "embedding_id": str | None,
            "processing_time_ms": int,
            "quality_details": dict,
        }
    """
    start = time.time()

    title = article.get("title", "")
    content = article.get("content", "")
    article_id = article.get("id")
    category = article.get("category")
    country_id = article.get("country_id")

    # ---------------------------------------------------------------
    # Step 1: Clean content and extract images
    # ---------------------------------------------------------------
    cleaning = clean_html_content(content, {
        "remove_images": True,
        "extract_image_urls": True,
        "min_content_length": 100,
        "remove_ad_elements": True,
    })
    cleaned = cleaning["cleaned_content"]
    images = cleaning["extracted_images"]

    # ---------------------------------------------------------------
    # Step 2: Extract keywords using AI
    # ---------------------------------------------------------------
    kw_result = await extract_keywords(
        title=title,
        content=cleaned,
        existing_category=category,
        country_id=country_id,
        env=env,
    )
    keywords = kw_result.get("keywords", [])

    # ---------------------------------------------------------------
    # Step 3: Calculate quality score (deterministic, no AI needed)
    # ---------------------------------------------------------------
    quality = score_quality(content=cleaned, title=title)
    quality_score = quality["quality_score"]

    # ---------------------------------------------------------------
    # Step 4: Generate content hash for duplicate detection
    # ---------------------------------------------------------------
    content_hash = hashlib.sha256((title + cleaned).encode("utf-8")).hexdigest()[:16]

    # ---------------------------------------------------------------
    # Step 5: Create embedding for Vectorize (if available)
    # ---------------------------------------------------------------
    embedding_id = None
    if env and cleaned and len(cleaned) > 50:
        try:
            text = f"{title}\n{cleaned[:500]}"
            embedding = await get_embedding(text, env)

            if embedding and article_id:
                embedding_id = f"article_{article_id}"
                # TODO: upsert to Vectorize once FFI is confirmed
                # await env.VECTORIZE_INDEX.upsert([{
                #     "id": embedding_id,
                #     "values": embedding,
                #     "metadata": {"title": title, "category": category},
                # }])
        except Exception as e:
            print(f"[ARTICLE_AI] Embedding failed for article {article_id}: {e}")

    processing_time_ms = int((time.time() - start) * 1000)

    # ---------------------------------------------------------------
    # Step 6: Persist results to MongoDB
    # ---------------------------------------------------------------
    if env and article_id:
        await _persist_results(env, article_id, {
            "processed_content": cleaned,
            "quality_score": quality_score,
            "content_hash": content_hash,
            "ai_processed": True,
            "ai_processed_at": _now_iso(),
        }, keywords)

    return {
        "cleaned_content": cleaned,
        "extracted_images": images,
        "keywords": keywords,
        "quality_score": quality_score,
        "content_hash": content_hash,
        "embedding_id": embedding_id,
        "processing_time_ms": processing_time_ms,
        "quality_details": quality,
    }


async def _persist_results(env, article_id, update_fields: dict, keywords: list[dict]):
    """Write processing results to MongoDB."""
    try:
        db = MongoDBClient(env)
        await db.update_one(
            "articles",
            {"_id": article_id},
            {"$set": update_fields},
        )

        # Store keyword links
        if keywords:
            kw_docs = [
                {
                    "article_id": article_id,
                    "keyword_id": kw.get("keyword", ""),
                    "relevance_score": kw.get("confidence", 0.7),
                    "source": "ai",
                }
                for kw in keywords
            ]
            await db.insert_many("article_keyword_links", kw_docs)

    except Exception as e:
        print(f"[ARTICLE_AI] MongoDB persist failed for {article_id}: {e}")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
