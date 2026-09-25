/**
 * Build `news.bylineDirectory` once, from a terminal, against MongoDB directly.
 *
 * ## Why this exists: the deploy order, not a convenience
 *
 * The byline snapshot is what `/author/[...slug]` resolves a slug out of. When
 * it does not exist, `lookupBylineIdentity` answers `unavailable` and the route
 * throws, so **every byline page on the platform answers 5xx**. That is the
 * correct answer — an unbuilt directory is "we could not look", and the one
 * thing it must never be is a 404 over a named journalist — but it is still an
 * outage, and shipping into it and waiting for the first cron is a choice
 * nobody has to make.
 *
 * Run this **before** the change deploys. Then the deploy lands on a populated
 * snapshot, the first request resolves, and the cron's job is keeping the
 * directory fresh rather than bringing it into existence.
 *
 * ## It calls the same code the cron does
 *
 * `getBylineDirectory` → `publishBylineDirectory`, the identical pair
 * `/api/cron/byline-directory` runs. There is deliberately **no second
 * implementation of the write** here: same `generation` stamping, same
 * upsert-then-sweep, same refusal to publish an empty build over a populated
 * snapshot. A seeding script that wrote the collection its own way would be a
 * second definition of the snapshot's shape, free to drift from the one the
 * app reads — and the first symptom of that drift is a byline page 404ing.
 *
 * It therefore depends on **nothing from the deployed build**: it imports the
 * repo's own source and connects with `MONGODB_URI` exactly as the app does.
 * A checkout, the env var, and network reach to Atlas are the whole
 * requirement.
 *
 * ## Running it
 *
 * ```bash
 * MONGODB_URI='mongodb+srv://…' MONGODB_DATABASE=news \
 *   pnpm dlx tsx scripts/seed-byline-directory.ts
 * ```
 *
 * `pnpm dlx` rather than a devDependency on purpose: this is a one-shot
 * operational script, and adding a runner to `package.json` would change
 * `pnpm-lock.yaml` — which every CI job and Vercel install from — to support
 * something no build ever runs.
 *
 * ⚠️ It writes to whatever `MONGODB_DATABASE` names (default `news`). It is
 * idempotent and safe to re-run: a second run republishes the same rows under a
 * new generation and sweeps the older one. It is **not** safe to run two copies
 * concurrently against the same database for the usual reasons, though the
 * `$lt` sweep means the loser of that race is a stale row rather than an empty
 * collection.
 *
 * Expect roughly **11 seconds** in the read, measured warm on the live M20 —
 * see `@/lib/mongodb/byline-directory` for why that is the cluster rather than
 * the query, and why the build was moved off the request path in the first
 * place.
 */

import { getBylineDirectory } from '../src/lib/mongodb/authors'
import { publishBylineDirectory } from '../src/lib/mongodb/byline-directory'

async function main(): Promise<number> {
  if (!process.env.MONGODB_URI) {
    // Fail before the read rather than surfacing a driver error from three
    // frames down. The env var is the whole prerequisite; say so plainly.
    console.error('MONGODB_URI is not set. Nothing was read and nothing was written.')
    return 1
  }

  const database = process.env.MONGODB_DATABASE || 'news'
  console.log(`Building the byline directory against "${database}" — this takes ~11s.`)

  const startedAt = Date.now()
  const { ok, bylines } = await getBylineDirectory()
  const readMs = Date.now() - startedAt
  console.log(`Read ${bylines.length} bylines in ${readMs}ms (ok=${ok}).`)

  const outcome = await publishBylineDirectory(bylines, ok)

  if (!outcome.published) {
    // The two refusals are the publisher protecting an existing snapshot, so
    // they are reported as failures rather than as a quiet success. `reason`
    // says which: `source-unavailable` is a failed corpus read,
    // `empty-build` is a build that found nothing over a populated snapshot.
    console.error(`REFUSED (${outcome.reason}). The snapshot was left exactly as it was.`)
    return 1
  }

  console.log(
    `Published ${outcome.written} rows, swept ${outcome.removed} older ones, ` +
      `generation ${outcome.generation}. Total ${Date.now() - startedAt}ms.`
  )
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[seed-byline-directory]', error)
    process.exit(1)
  })
