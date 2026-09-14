import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { WelcomeGate } from "../welcome-gate";
import { LegalProvider } from "@/contexts/legal-context";
import { LEGAL_ACCEPTANCE_KEY, LEGAL_VERSION } from "@/lib/legal";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/ui/app-icon", () => ({
  AppIcon: () => <span data-testid="app-icon" />,
}));

function mount() {
  return render(
    <LegalProvider>
      <WelcomeGate />
    </LegalProvider>,
  );
}

const dialog = () => screen.queryByRole("dialog");

describe("WelcomeGate", () => {
  beforeEach(() => {
    pathname = "/";
    window.localStorage.clear();
    document.body.style.overflow = "";
  });

  it("asks a first-time reader to accept, and says what Mukoko is", async () => {
    mount();
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(screen.getByText(/we do not publish news/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Terms of Service" }),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("stores the VERSION accepted, not a boolean", async () => {
    // A boolean records that somebody once accepted something without
    // recording WHAT, which makes a later material change unannounceable.
    mount();
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /i agree/i }));

    expect(window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY)).toBe(
      LEGAL_VERSION,
    );
    expect(window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY)).not.toBe("true");
    expect(dialog()).toBeNull();
  });

  it("does not ask again once the current version is accepted", async () => {
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, LEGAL_VERSION);
    mount();
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
    expect(dialog()).toBeNull();
  });

  it("DOES ask again when the stored acceptance predates the current terms", async () => {
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, "2020-01-01");
    mount();
    await waitFor(() => expect(dialog()).toBeInTheDocument());
  });

  it.each(["/terms", "/privacy"])("never covers %s", async (route) => {
    // The gate asks a reader to accept two documents. Covering the documents
    // would have them agreeing to text they were prevented from reading.
    pathname = route;
    mount();
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
    expect(dialog()).toBeNull();
  });

  it.each(["/embed", "/embed/iframe", "/offline"])(
    "never covers %s",
    async (route) => {
      pathname = route;
      mount();
      await waitFor(() => expect(document.body.style.overflow).toBe(""));
      expect(dialog()).toBeNull();
    },
  );

  it("renders nothing before storage has answered", () => {
    // The first paint is the SERVER's page. A gate in the prerendered HTML is
    // what every crawler would index instead of the article.
    const { container } = render(
      <LegalProvider initial={{ resolved: false, accepted: false }}>
        <WelcomeGate />
      </LegalProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("locks the page behind it and releases on accept", async () => {
    mount();
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    fireEvent.click(screen.getByRole("button", { name: /i agree/i }));
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
  });

  it("is not dismissible by Escape", async () => {
    // Escape closes a dialog you may dismiss. Wiring it here would hand every
    // reader a one-key bypass and make the screen a suggestion.
    mount();
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeInTheDocument();
    expect(window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY)).toBeNull();
  });

  it("offers no way through other than agreeing", async () => {
    mount();
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/i agree/i);
  });

  it("lets the reader through even when storage refuses to remember", async () => {
    // A private window or blocked site data must not trap someone on the
    // consent screen; they will simply be asked again next visit.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    try {
      mount();
      await waitFor(() => expect(dialog()).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /i agree/i }));
      expect(dialog()).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});
