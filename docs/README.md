# Design docs

Self-contained HTML pages. Open them in a browser — no build step, no dependencies.

| Doc | What it covers |
| --- | --- |
| [`classification-mapping.html`](./classification-mapping.html) | Topics, interest categories, stories and tags — what each layer is for, the best-fit mapping from the pipeline's 17 slugs onto the platform's 40 interests, and the build order. Tracked in [#158](https://github.com/nyuchi/mukoko-news/issues/158). |
| [`feed-architecture.html`](./feed-architecture.html) | The ingestion and enrichment pipeline, the app's read path, and the offset-versus-keyset rebuild of the feed. |

Both carry the measurements they argue from — query plans taken with `explain`
against the live Atlas cluster, and corpus counts as at 10 September 2026 — so a
claim can be re-checked rather than taken on trust.

These are snapshots. Where they disagree with the code, the code is right and the
doc needs a commit.
