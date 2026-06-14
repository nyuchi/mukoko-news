"""Tests for engagement job.

Engagement on this platform is E2E encrypted and device-aggregated.
The recalc job is intentionally a no-op — individual interaction
counts are never stored on articles server-side.
"""

import pytest

from src.jobs.engagement import recalc_engagement_scores


class TestEngagement:
    async def test_recalc_runs_without_error(self):
        """Engagement recalc is a no-op — must not raise."""
        await recalc_engagement_scores()
