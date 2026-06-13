"""Engagement score recalculation job.

NOTE: Engagement on this platform is end-to-end encrypted and device-aggregated
(see engagement.aggregateDefinitions in MongoDB). Individual interaction counts
are NOT stored on articles. This job is a no-op placeholder — aggregate signals
flow through Doris via device contributions, not through this pipeline.
"""


async def recalc_engagement_scores() -> None:
    """No-op: engagement is E2E encrypted and device-side aggregated."""
    pass
