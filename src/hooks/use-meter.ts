"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";

import {
  allowanceOf,
  planFor,
  withinAllowance,
  type Allowance,
  type Meter,
  type Plan,
} from "@/lib/access";
import { clearMeter, readMeter, recordMeterUse } from "@/lib/metering";

/**
 * One metered capability, resolved for the reader currently looking at it.
 *
 * Joins the three parts that must never be re-derived at a call site: the plan
 * (`@/lib/access`), the ceiling that plan has (`allowanceOf`), and what has
 * already been used (`@/lib/metering`). A component asks this and renders; it
 * does not do arithmetic on allowances, because a wall computed two ways is a
 * wall that disagrees with itself between surfaces.
 */
export interface MeterStatus {
  plan: Plan;
  /** `null` when this plan has no ceiling — nothing to count, nothing to wall. */
  allowance: Allowance;
  used: number;
  /** How many remain, or `null` when there is no ceiling. */
  remaining: number | null;
  /** May the reader have another one? */
  allowed: boolean;
  /**
   * The count has been read and the session resolved.
   *
   * Until this is true `used` is 0 and `allowed` is optimistic. Callers that
   * would otherwise reveal something on a wrong guess must wait for it — see
   * the note on which way each surface should guess, below.
   */
  ready: boolean;
  /** Count one use. Pass an id to deduplicate (the same article twice is one). */
  record: (id?: string) => void;
  /**
   * Has this id already been counted against the allowance?
   *
   * Load-bearing at the limit, not a convenience. Dedupe alone says the
   * fifty-first *distinct* article is the one that walls — but it also means a
   * reader sitting exactly on fifty who reopens article number thirty finds it
   * walled, because `used` is still fifty and the comparison does not care
   * which article is on screen. Taking something back that was already given is
   * the one move that reads as the site breaking rather than as a boundary, so
   * an id already spent stays readable for good.
   */
  hasCounted: (id: string) => boolean;
}

/**
 * ⚠️ **Before `ready`, this hook guesses ALLOWED, and every caller must know
 * which way its own surface should guess.**
 *
 * Reading is optimistic because the article was already delivered in the HTML:
 * showing it for a frame and then walling costs nothing, while starting walled
 * would flash a sign-up screen over every article on every load — including for
 * the crawlers whose traffic this product runs on.
 *
 * A surface where the metered thing is *not already on the page* must invert
 * that itself and render its locked state until `ready`, exactly as
 * `ArticleSummary` does. This hook cannot make that choice for it, because the
 * two surfaces fail in opposite directions.
 */
export function useMeter(meter: Meter): MeterStatus {
  const { user, loading } = useAuth();
  const [used, setUsed] = useState(0);
  const [counted, setCounted] = useState<readonly string[]>([]);
  const [read, setRead] = useState(false);

  const plan = planFor(!!user);
  const allowance = allowanceOf(meter, plan);
  const ready = !loading && read;

  useEffect(() => {
    // A plan with no ceiling has nothing to count, and carrying an old tally
    // would drop a reader back onto a wall they already answered the moment
    // they signed out. Clearing on the way in is the metering counterpart of
    // `claimSessionEngagement` doing it for likes and saves.
    if (allowance === null) {
      clearMeter(meter);
      setUsed(0);
      setCounted([]);
      setRead(true);
      return;
    }
    const reading = readMeter(meter);
    setUsed(reading.used);
    setCounted(reading.ids);
    setRead(true);
  }, [meter, allowance]);

  const record = useCallback(
    (id?: string) => {
      if (allowanceOf(meter, plan) === null) return;
      setUsed(recordMeterUse(meter, id));
      if (id !== undefined) {
        setCounted((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
    },
    [meter, plan],
  );

  const hasCounted = useCallback(
    (id: string) => counted.includes(id),
    [counted],
  );

  return {
    plan,
    allowance,
    used,
    remaining: allowance === null ? null : Math.max(0, allowance - used),
    allowed: ready ? withinAllowance(meter, plan, used) : true,
    ready,
    record,
    hasCounted,
  };
}
