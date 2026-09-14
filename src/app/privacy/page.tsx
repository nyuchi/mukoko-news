import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { getFullUrl } from "@/lib/constants";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Mukoko News collects, what it does not, and why. We run no third-party analytics, no advertising trackers, and we do not sell personal information.",
  alternates: { canonical: getFullUrl("/privacy") },
  robots: { index: true, follow: true },
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 leading-relaxed text-text-secondary">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <PageContainer width="reading">
      <h1 className="mb-2 text-3xl font-bold text-foreground">
        Privacy Policy
      </h1>
      <p className="mb-8 text-text-secondary">
        Last updated: {LEGAL_LAST_UPDATED}
      </p>

      {/*
        What we DON'T do leads, because it is the shorter and more useful list,
        and because every item in it is a checkable claim rather than a posture.
        A policy that opens with "we are committed to protecting your privacy"
        has told the reader nothing.
      */}
      <div className="mb-10 rounded-2xl bg-surface p-5 ring-1 ring-outline">
        <p className="font-medium text-foreground">The short version</p>
        <ul className="mt-3 list-inside list-disc space-y-2 leading-relaxed text-text-secondary">
          <li>
            No third-party analytics. No Google Analytics, no tag manager, no
            pixels.
          </li>
          <li>No advertising trackers, and no advertising.</li>
          <li>We do not sell or rent personal information, to anyone, ever.</li>
          <li>
            Your country and category preferences never leave your device.
          </li>
          <li>You can read the entire site without an account.</li>
        </ul>
      </div>

      <div className="max-w-none space-y-8">
        <Section title="What this covers">
          <p>
            Mukoko News is a news aggregator operated by Nyuchi Africa. This
            policy explains what we collect when you use the website, the
            installed app or our APIs, and what we do with it.
          </p>
          <p>
            It does not cover the publishers we link to. When you follow a link
            to an article you are on their site, under their policy, and they
            may collect things we do not.
          </p>
        </Section>

        <Section title="What stays on your device">
          <p>
            Your{" "}
            <strong className="text-foreground">
              country and category preferences
            </strong>
            , the sidebar and appearance settings, and — if you grant location
            access for the weather strip — your last coarse position are stored
            in your browser&rsquo;s local storage. They are not sent to us and
            we cannot read them. Clearing your browser data removes them.
          </p>
          <p>
            Because they are per-browser, these settings do not follow you to
            another device. That is a limitation, not a feature, and it is the
            honest trade for not holding them.
          </p>
        </Section>

        <Section title="What we store">
          <h3 className="font-medium text-foreground">If you are signed out</h3>
          <p>
            Nothing, until you interact. The first time you like, save or open
            an article we set a single cookie,{" "}
            <code className="font-mono text-sm">mukoko_session</code>,
            containing a random identifier and nothing else. It is{" "}
            <code className="font-mono text-sm">HttpOnly</code> and{" "}
            <code className="font-mono text-sm">SameSite=Strict</code>, so it
            cannot be read by scripts and is never sent to another site. It
            exists so that your saved articles are still there when you come
            back, and it is the only cookie we set.
          </p>

          <h3 className="pt-2 font-medium text-foreground">
            If you are signed in
          </h3>
          <p>
            Accounts are handled by WorkOS. We hold the profile record it
            creates — your name, username, profile picture and any interests you
            choose — plus your saved articles, likes and the preferences you set
            from your profile. Your likes and saves move from the cookie to your
            account the first time you interact while signed in, so your history
            follows you between devices.
          </p>

          <h3 className="pt-2 font-medium text-foreground">Operationally</h3>
          <p>
            We record article view, like and save counts against that
            identifier. We apply rate limits by IP address to keep the service
            up. We receive browser-reported security policy violations. Server
            logs from our hosting providers contain the usual request metadata
            for a short period.
          </p>
          <p>
            We do not build an advertising profile, we do not track you across
            other websites, and we have no relationship with any data broker.
          </p>
        </Section>

        <Section title="Images are proxied, and that is a privacy decision">
          <p>
            Publisher photographs and site icons are not loaded into your
            browser from the publisher&rsquo;s servers. They are fetched by our
            own image service and cached there, so your IP address, browser
            details and referring page are never handed to a third-party image
            host just because you scrolled past a headline.
          </p>
          <p>
            One consequence worth stating plainly: it means we see the image
            requests instead. We use them to serve and cache the image, and for
            nothing else.
          </p>
        </Section>

        <Section title="Location and the weather strip">
          <p>
            The date and weather strip in the header can show conditions where
            you are. It{" "}
            <strong className="text-foreground">never asks on page load</strong>{" "}
            — it checks whether you have already granted location access to this
            site and, if you have not, shows a &ldquo;Use my location&rdquo;
            control and waits for you to press it.
          </p>
          <p>
            If you do grant it, your coordinates are rounded to roughly a
            kilometre before they leave your device, and sent to our sibling
            weather service to resolve conditions. Weather does not vary street
            by street, and a precise fix is your home address. If you decline,
            the service falls back to an approximate location derived from your
            IP address, which is frequently wrong on a mobile network and is
            only ever used to pick a forecast.
          </p>
        </Section>

        <Section title="Automated processing and AI">
          <p>
            We use automated tools, including machine-learning models, to
            categorise articles, extract keywords and named entities, estimate
            sentiment, generate short summaries and build embeddings for search.
            These run over{" "}
            <strong className="text-foreground">published news content</strong>{" "}
            — the articles we aggregate — and not over your account, your
            reading history or anything you have saved.
          </p>
          <p>
            We do not use your personal data to train AI models, and we do not
            pass it to model providers.
          </p>
        </Section>

        <Section title="Who processes data for us">
          <p>These providers run parts of the platform on our behalf:</p>
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong className="text-foreground">Vercel</strong> — hosting and
              delivery of the website
            </li>
            <li>
              <strong className="text-foreground">MongoDB Atlas</strong> — the
              database holding articles, accounts and engagement records
            </li>
            <li>
              <strong className="text-foreground">Cloudflare</strong> — our API
              gateway, the image service, and the gateway that routes automated
              content processing
            </li>
            <li>
              <strong className="text-foreground">Fly.io</strong> — the
              background service that collects articles from publisher feeds
            </li>
            <li>
              <strong className="text-foreground">WorkOS</strong> — sign-in and
              account identity
            </li>
            <li>
              <strong className="text-foreground">Upstash</strong> — rate-limit
              counters, where configured
            </li>
          </ul>
        </Section>

        <Section title="Keeping and deleting">
          <p>
            Preferences live on your device until you clear them. The anonymous
            session cookie lasts a year unless you delete it. Account data is
            kept while your account exists.
          </p>
          <p>
            To see, correct or delete what we hold about you, or to close your
            account, write to{" "}
            <a
              href="mailto:privacy@mukoko.com"
              className="text-primary hover:underline"
            >
              privacy@mukoko.com
            </a>
            . Depending on where you live you may have additional rights over
            your data; we will honour a request whether or not a law compels us
            to.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Mukoko News is a general news service and is not directed at
            children. We do not knowingly collect personal information from
            anyone under 13.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update this policy. The date at the top always reflects the
            current version, and we will ask you to accept again where a change
            is material. See also our{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Privacy questions or requests:{" "}
            <a
              href="mailto:privacy@mukoko.com"
              className="text-primary hover:underline"
            >
              privacy@mukoko.com
            </a>
            .
          </p>
        </Section>
      </div>
    </PageContainer>
  );
}
