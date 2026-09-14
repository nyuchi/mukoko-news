"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  LEGAL_VERSION,
  hasAcceptedCurrentTerms,
  recordTermsAcceptance,
} from "@/lib/legal";

interface LegalState {
  /**
   * False until the effect has read storage.
   *
   * Nothing may branch on `accepted` before this is true. The check runs in an
   * effect rather than during render because `localStorage` does not exist on
   * the server, and the whole point of the arrangement is that the SERVER
   * RENDERS THE PAGE ITSELF — a gate baked into the prerendered HTML would be
   * what every crawler and every answer engine saw instead of the article, and
   * for an aggregator that traffic is the product. So the first paint is the
   * page; the gate arrives a frame later, for humans only.
   */
  resolved: boolean;
  /** Whether this browser has accepted the CURRENT version of the terms. */
  accepted: boolean;
  accept: () => void;
}

const LegalContext = createContext<LegalState>({
  resolved: false,
  accepted: false,
  accept: () => {},
});

/**
 * One answer to "has this reader accepted the terms", shared by everything
 * that needs it.
 *
 * It is a context rather than a per-component `localStorage` read because two
 * first-run surfaces have to agree about it: the welcome gate, which asks, and
 * the preferences onboarding modal, which must NOT appear behind it. Two
 * modals stacked on a first visit is the failure this prevents, and it cannot
 * be prevented by two components each reading storage on their own — accepting
 * in one would not tell the other until a reload.
 */
export function LegalProvider({
  children,
  /** Test seam: skip the storage read and start from a known state. */
  initial,
}: {
  children: React.ReactNode;
  initial?: { resolved: boolean; accepted: boolean };
}) {
  const [resolved, setResolved] = useState(initial?.resolved ?? false);
  const [accepted, setAccepted] = useState(initial?.accepted ?? false);

  useEffect(() => {
    if (initial) return;
    setAccepted(hasAcceptedCurrentTerms());
    setResolved(true);
  }, [initial]);

  // Another tab accepting counts here too — otherwise a reader who accepted in
  // one tab is still gated in the one they left open, with no way to tell why.
  useEffect(() => {
    const onStorage = () => setAccepted(hasAcceptedCurrentTerms());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const accept = useCallback(() => {
    // State first, storage second: a browser that refuses to remember the
    // acceptance must still let the reader through this visit. They will be
    // asked again next time, which is the honest consequence of a browser that
    // will not remember anything — see `recordTermsAcceptance`.
    setAccepted(true);
    setResolved(true);
    recordTermsAcceptance();
  }, []);

  const value = useMemo(
    () => ({ resolved, accepted, accept }),
    [resolved, accepted, accept],
  );
  return (
    <LegalContext.Provider value={value}>{children}</LegalContext.Provider>
  );
}

export function useLegal(): LegalState {
  return useContext(LegalContext);
}

/** Re-exported so consumers need only one import. */
export { LEGAL_VERSION };
