import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  AGGREGATOR_STATEMENT,
  LEGAL_ACCEPTANCE_KEY,
  LEGAL_LAST_UPDATED,
  LEGAL_VERSION,
  hasAcceptedCurrentTerms,
  recordTermsAcceptance,
} from "@/lib/legal";

describe("the published version and the date shown on the pages agree", () => {
  it("names the same day", () => {
    // Three surfaces read these — /terms, /privacy and the acceptance screen —
    // and the version is what decides whether a reader is re-prompted. Bumping
    // one and not the other means the pages show a date that is not the
    // revision anyone actually consented to.
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const shown = new Date(`${LEGAL_LAST_UPDATED} UTC`);
    expect(Number.isNaN(shown.getTime())).toBe(false);
    expect(shown.toISOString().slice(0, 10)).toBe(LEGAL_VERSION);
  });

  it("states the aggregator position in one place", () => {
    // Stating it differently in different places is how a platform ends up
    // having claimed, somewhere, to be the publisher of somebody else's work.
    expect(AGGREGATOR_STATEMENT).toMatch(/do not publish news/i);
    expect(AGGREGATOR_STATEMENT).toMatch(/aggregator/i);
  });
});

describe("acceptance storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips the version", () => {
    expect(hasAcceptedCurrentTerms()).toBe(false);
    recordTermsAcceptance();
    expect(window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY)).toBe(
      LEGAL_VERSION,
    );
    expect(hasAcceptedCurrentTerms()).toBe(true);
  });

  it("treats an older accepted version as not accepted", () => {
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, "2020-01-01");
    expect(hasAcceptedCurrentTerms()).toBe(false);
  });

  it("does not treat a bare `true` as acceptance", () => {
    // Guards the migration direction: if the key were ever written as a
    // boolean again, every existing reader would silently count as having
    // agreed to whatever the terms say next.
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, "true");
    expect(hasAcceptedCurrentTerms()).toBe(false);
  });

  it('reports "not accepted" rather than throwing when storage is unreadable', () => {
    // A private window, blocked site data, or a disabled-storage browser makes
    // localStorage throw. A throw must not decide the answer and must not
    // break the page — it means we cannot PROVE acceptance, so we ask.
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      expect(hasAcceptedCurrentTerms()).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });

  it("does not throw when storage refuses the write", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    try {
      expect(() => recordTermsAcceptance()).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
