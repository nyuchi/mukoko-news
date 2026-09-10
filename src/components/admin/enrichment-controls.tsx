'use client';

import { useState } from 'react';
import { Loader2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { drainEnrichmentBacklog } from '@/lib/admin/gateway';

/**
 * The admin control for the enrichment backlog drain.
 *
 * WHY THIS EXISTS
 * ---------------
 * Enrichment had three triggers and none of them was a role. The pipeline's
 * notify hook (`ENRICHMENT_API_TOKEN`) and the fly-worker trigger
 * (`FLY_TRIGGER_TOKEN`) are shared *service secrets*, and the agent's Durable
 * Object drains on its own schedule. So the only way to let a person re-run
 * enrichment was to hand them a service credential — and `/admin/system`
 * described enrichment without offering any control over it.
 *
 * The gateway's `POST /api/admin/enrich/backlog` sits inside `/api/admin/*` and
 * inherits the platform-org WorkOS check, so the button is a role, not a secret.
 *
 * THE STATES ARE NOT COSMETIC
 * ---------------------------
 * A drain is fire-and-forget: the gateway returns 202 as soon as the enrichment
 * worker accepts, and the work continues in a Durable Object well after this
 * request is over. So "started" is the honest ceiling of what this button can
 * report — it must never claim the backlog is cleared. Equally, a 503 (gateway
 * not wired up) is rendered as a distinct failure rather than folded into
 * success, because "drain started" and "nothing is configured" look identical
 * from a caller that only checks for an absence of errors.
 */
export function EnrichmentControls() {
  const [state, setState] = useState<'idle' | 'running' | 'started' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState('running');
    setMessage(null);
    try {
      const result = await drainEnrichmentBacklog();
      if (result.ok) {
        setState('started');
        setMessage(null);
      } else {
        setState('failed');
        // The gateway never returns the upstream body (it can embed a connection
        // string), so `error` is already a safe, generic message.
        setMessage(result.error ?? `Gateway returned ${result.status}.`);
      }
    } catch {
      // A Server Action can reject outright (network, deploy in flight). Without
      // this the button would stay spinning forever with nothing said.
      setState('failed');
      setMessage('Could not reach the gateway.');
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-outline p-5">
      <div className="flex items-center gap-3 mb-3">
        <Sparkles className="w-6 h-6 text-secondary" />
        <span className="font-medium text-foreground">AI enrichment</span>
      </div>

      <p className="text-sm text-text-secondary mb-4">
        Runs the enrichment worker over unprocessed articles — keywords, quality,
        classification, sentiment and embeddings. The agent already drains on its own
        schedule; this is the manual path for after an outage or a large ingest.
      </p>

      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="inline-flex items-center justify-center gap-2 px-4 min-h-[var(--touch-input,43px)] rounded-xl bg-primary text-on-primary font-medium text-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {state === 'running' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
        {state === 'running' ? 'Starting…' : 'Run backlog drain'}
      </button>

      {/* aria-live so the outcome reaches a screen reader: the button label does
          not change on completion, so a silent swap would be invisible. */}
      <div aria-live="polite" className="mt-3 min-h-[1.25rem]">
        {state === 'started' && (
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Drain started. It runs in the enrichment worker and continues after this page
              — this does not report when it finishes.
            </span>
          </p>
        )}
        {state === 'failed' && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{message}</span>
          </p>
        )}
      </div>
    </div>
  );
}
