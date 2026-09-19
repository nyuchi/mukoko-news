import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  readMeter,
  recordMeterUse,
  clearMeter,
  clearAllMeters,
} from "@/lib/metering";

const KEY = "mukoko-news-meter-articles";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readMeter", () => {
  it("reads zero for a meter never used", () => {
    expect(readMeter("articles")).toEqual({ used: 0, ids: [] });
  });

  it("reads back what was recorded", () => {
    recordMeterUse("articles", "a-1");
    recordMeterUse("articles", "a-2");
    expect(readMeter("articles")).toEqual({ used: 2, ids: ["a-1", "a-2"] });
  });

  it("keeps each meter in its own key, so clearing one never clears another", () => {
    recordMeterUse("articles", "a-1");
    recordMeterUse("searches");
    clearMeter("searches");
    expect(readMeter("articles").used).toBe(1);
    expect(readMeter("searches").used).toBe(0);
  });

  it("trusts the id list over a count below it, because ids are harder evidence", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ used: 1, ids: ["a", "b", "c"] }),
    );
    expect(readMeter("articles").used).toBe(3);
  });

  it("survives every shape of corrupted record", () => {
    for (const junk of ["", "not json", "null", "[]", '"a string"', "42"]) {
      window.localStorage.setItem(KEY, junk);
      expect(readMeter("articles")).toEqual({ used: 0, ids: [] });
    }
  });

  it("discards non-string ids and a negative or non-finite count", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ used: -5, ids: ["ok", 3, null, { x: 1 }] }),
    );
    expect(readMeter("articles")).toEqual({ used: 1, ids: ["ok"] });
  });
});

describe("a reader who cannot be counted is not walled", () => {
  // ⚠️ The direction here is the whole point, and it is deliberately the
  // OPPOSITE of `withinAllowance`, which treats a broken count as exhausted.
  // A non-finite `used` can only come from a miswired counter; a throwing
  // storage read is a person in a private window. Walling them for good would
  // make the product unusable over a choice they are entitled to make.
  it("reads zero used when storage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readMeter("articles")).toEqual({ used: 0, ids: [] });
  });

  it("does not throw when storage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => recordMeterUse("articles", "a-1")).not.toThrow();
  });

  it("does not throw when storage throws on clear", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => clearAllMeters()).not.toThrow();
  });
});

describe("recordMeterUse", () => {
  it("deduplicates by id — the same article twice is one article", () => {
    expect(recordMeterUse("articles", "a-1")).toBe(1);
    expect(recordMeterUse("articles", "a-1")).toBe(1);
    expect(recordMeterUse("articles", "a-1")).toBe(1);
    expect(readMeter("articles").used).toBe(1);
  });

  it("counts every call when there is no id — a search is an event", () => {
    expect(recordMeterUse("searches")).toBe(1);
    expect(recordMeterUse("searches")).toBe(2);
    expect(recordMeterUse("searches")).toBe(3);
  });

  it("caps the remembered id list so a long-lived device cannot grow it forever", () => {
    for (let i = 0; i < 260; i++) recordMeterUse("articles", `a-${i}`);
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(stored.ids.length).toBeLessThanOrEqual(200);
    // The COUNT is not capped — only the dedupe memory is. Truncating the
    // count would silently hand a heavy reader their allowance back.
    expect(stored.used).toBe(260);
  });
});

describe("clearMeter", () => {
  it("forgets a meter entirely", () => {
    recordMeterUse("articles", "a-1");
    clearMeter("articles");
    expect(readMeter("articles")).toEqual({ used: 0, ids: [] });
  });

  it("clearAllMeters forgets every one of them", () => {
    recordMeterUse("articles", "a-1");
    recordMeterUse("searches");
    recordMeterUse("ai-summary", "a-1");
    clearAllMeters();
    expect(readMeter("articles").used).toBe(0);
    expect(readMeter("searches").used).toBe(0);
    expect(readMeter("ai-summary").used).toBe(0);
  });
});
