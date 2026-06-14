"""Engagement signal aggregation job.

Reads device-contributed engagement aggregates from the engagement database
and updates news.articles bundu.ubuntuScoreSnapshot.

Architecture note: individual interaction counts are E2E encrypted and never
stored server-side. Only device-aggregated contributions flow through
engagement.aggregateContributions once absorbed. This job reads those absorbed
buckets and computes article-level signals for ranking and trending.
"""

from datetime import datetime, timezone

from src.services.mongodb import get_engagement_db, get_news_db


async def recalc_engagement_scores() -> None:
    """Sync absorbed engagement aggregate contributions to article ubuntuScores."""
    engagement_db = get_engagement_db()
    news_db = get_news_db()

    # Pull absorbed contributions targeting news articles
    contributions = await engagement_db["aggregateContributions"].find(
        {"isAbsorbed": True, "isSuppressed": False},
        projection={"aggregateDefinitionId": 1, "contributionPayload": 1},
        limit=500,
    ).to_list(500)

    if not contributions:
        return

    # Resolve definition IDs to understand what each contribution measures
    definition_ids = list({c["aggregateDefinitionId"] for c in contributions})
    definitions = await engagement_db["aggregateDefinitions"].find(
        {"_id": {"$in": definition_ids}, "isActive": True},
        projection={"_id": 1, "aggregateType": 1, "scopeFilters": 1},
    ).to_list(None)
    definition_map = {d["_id"]: d for d in definitions}

    # Accumulate signals per article
    article_signals: dict[str, dict] = {}
    for contrib in contributions:
        defn = definition_map.get(contrib["aggregateDefinitionId"])
        if not defn:
            continue

        scope = defn.get("scopeFilters", {})
        article_id = scope.get("articleId") or scope.get("targetId")
        if not article_id:
            continue

        payload = contrib.get("contributionPayload", {})
        signals = article_signals.setdefault(article_id, {
            "reactionCount": 0, "completionRate": 0.0,
            "shareRate": 0.0, "samples": 0,
        })
        signals["reactionCount"] += payload.get("reactionCount", 0)
        if "completionRate" in payload:
            signals["completionRate"] += payload["completionRate"]
            signals["shareRate"] += payload.get("shareRate", 0.0)
            signals["samples"] += 1

    if not article_signals:
        return

    now = datetime.now(timezone.utc)
    updated = 0
    for article_id, signals in article_signals.items():
        samples = max(signals["samples"], 1)
        ubuntu_score = round(
            min(100.0, signals["reactionCount"] * 2.0) * 0.4
            + (signals["completionRate"] / samples) * 100.0 * 0.4
            + (signals["shareRate"] / samples) * 100.0 * 0.2,
            2,
        )
        result = await news_db["articles"].update_one(
            {"_id": article_id},
            {"$set": {"bundu.ubuntuScoreSnapshot": ubuntu_score, "updatedAt": now}},
        )
        if result.modified_count:
            updated += 1

    print(f"[ENGAGEMENT] Updated ubuntuScore on {updated}/{len(article_signals)} articles")
