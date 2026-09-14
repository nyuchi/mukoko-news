import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { getFullUrl } from "@/lib/constants";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Mukoko News. We are a news aggregator: we provide the vehicle, we do not publish news. Every article, photograph and video belongs to the newsroom that produced it.",
  alternates: { canonical: getFullUrl("/terms") },
  robots: { index: true, follow: true },
};

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold text-foreground">
        {n}. {title}
      </h2>
      <div className="space-y-3 leading-relaxed text-text-secondary">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <PageContainer width="reading">
      <h1 className="mb-2 text-3xl font-bold text-foreground">
        Terms of Service
      </h1>
      <p className="mb-8 text-text-secondary">
        Last updated: {LEGAL_LAST_UPDATED}
      </p>

      {/*
        The aggregator position leads, before acceptance, because it is the
        thing a reader most needs to understand and the thing most often got
        wrong about a service like this. Everything below follows from it.
      */}
      <div className="mb-10 rounded-2xl bg-surface p-5 ring-1 ring-outline">
        <p className="font-medium text-foreground">
          Mukoko News is a news aggregator. We provide the vehicle — the index,
          the search, the feed. We do not publish news.
        </p>
        <p className="mt-3 leading-relaxed text-text-secondary">
          We are not a newspaper, a newsroom or a publishing house, and we do
          not employ journalists to produce the articles you read here. Every
          article, headline, photograph and video on this platform was made by
          somebody else, belongs to them, and is credited and linked back to
          them.
        </p>
      </div>

      <div className="max-w-none space-y-8">
        <Section n={1} title="Accepting these terms">
          <p>
            By using Mukoko News — the website, the installed app, the API or
            the MCP interface — you agree to these terms and to our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            . If you do not agree, please do not use the service.
          </p>
          <p>
            You may be asked to confirm acceptance the first time you use the
            app, and again if we make a material change to these terms.
          </p>
        </Section>

        <Section n={2} title="What the service does">
          <p>
            Mukoko News discovers, indexes and organises news published by
            African newsrooms and other outlets, and presents it so you can find
            it in one place. We show a headline, a short extract, publication
            details and — where the publisher supplies one — an image, alongside
            a link to the article on the publisher&rsquo;s own site.
          </p>
          <p>
            We collect this material from channels publishers make openly
            available for exactly this purpose, principally RSS and Atom feeds
            and licensed syndication APIs. Where a publisher tells us to stop,
            we stop; see{" "}
            <a href="#removal" className="text-primary hover:underline">
              Publisher rights and removal
            </a>
            .
          </p>
          <p>
            Reading an article in full means going to the publisher. That is
            deliberate. We are a route to their journalism, not a replacement
            for it.
          </p>
        </Section>

        <Section n={3} title="We do not own the content">
          <p>
            All rights in the articles, headlines, photographs, illustrations,
            video and audio shown on Mukoko News remain with their original
            publishers, photographers, agencies and other rights holders.
            Nothing here transfers any of those rights to us, and nothing here
            grants them to you.
          </p>
          <p id="images">
            <strong className="text-foreground">Images in particular.</strong>{" "}
            Photographs and other imagery are supplied by the publisher with the
            article and are displayed with a credit identifying where they came
            from. They are frequently licensed to that publisher from a news
            agency or an individual photographer, on terms we are not party to.
            You may not download, copy, redistribute, crop out a credit, or use
            any image from this platform for any purpose. If you want to use a
            photograph, licence it from the rights holder.
          </p>
          <p>
            We claim no editorial ownership of, and assert no editorial control
            over, any article we index. We did not commission it, we did not
            edit it, and we cannot correct it.
          </p>
        </Section>

        <Section n={4} title="What we do own">
          <p>
            The Mukoko News platform itself — the software, the design, the
            Mukoko name and Seed of Life mark, and the way the corpus is
            organised and presented — belongs to Nyuchi Africa. The aggregate
            statistics we publish about the corpus (country coverage, volumes
            over time and similar figures) are ours, and you are welcome to use
            the ones we publish as open data.
          </p>
        </Section>

        <Section n={5} title="Automated processing and AI">
          <p>
            We use automated tools, including machine-learning models, to
            categorise articles, extract keywords and named entities, estimate
            sentiment, and generate short summaries. These outputs are ours,
            they are generated by software without human review, and they are
            not the work or the opinion of the publisher.
          </p>
          <p>
            A machine-written summary can be wrong, can miss the point of an
            article, and is never a substitute for reading the original. Where a
            summary and the article disagree, the article is authoritative.
            Nothing produced by these tools should be read as a correction to,
            or an endorsement of, the journalism it describes.
          </p>
        </Section>

        <Section n={6} title="Accuracy is the publisher's, not ours">
          <p>
            We do not verify the articles we index. We make no representation
            about the accuracy, completeness, timeliness or fairness of any
            article, and the views expressed in one are those of its author and
            publisher alone.
          </p>
          <p>
            If an article is wrong, the correction has to come from the newsroom
            that published it. Contact them. If they amend or withdraw it, our
            copy of the metadata follows on the next collection.
          </p>
        </Section>

        <Section n={7} title="Publisher rights and removal">
          <p id="removal">
            If you are a publisher, photographer or other rights holder and you
            want your material removed from Mukoko News, or your feed excluded
            entirely, write to{" "}
            <a
              href="mailto:legal@mukoko.com"
              className="text-primary hover:underline"
            >
              legal@mukoko.com
            </a>{" "}
            and we will act on it. Tell us who you are, what you want removed,
            and what your relationship to it is.
          </p>
          <p>
            We would rather hear from you than not. Being indexed here is meant
            to send readers to your site, and if it is not doing that for you we
            would sooner remove you than argue about it.
          </p>
          <p>
            Publishers can also claim their profile and manage how their
            newsroom appears — see{" "}
            <Link
              href="/publishers/claim"
              className="text-primary hover:underline"
            >
              Claim your publication
            </Link>
            .
          </p>
        </Section>

        <Section n={8} title="Your account and conduct">
          <p>
            Some features — saving articles, preferences that follow your
            account, the analytics console — require signing in. You are
            responsible for what happens under your account.
          </p>
          <p>When using Mukoko News you agree not to:</p>
          <ul className="list-inside list-disc space-y-2">
            <li>Use the service for any unlawful purpose</li>
            <li>
              Attempt to gain unauthorised access to our systems or anyone
              else&rsquo;s account
            </li>
            <li>
              Interfere with the operation of the service, or place an
              unreasonable load on it
            </li>
            <li>
              Bulk-copy, scrape or redistribute publisher content from this
              platform — the content is not ours to licence to you
            </li>
            <li>Remove, obscure or alter any source credit or attribution</li>
            <li>Impersonate anyone, or misrepresent your affiliation</li>
          </ul>
        </Section>

        <Section n={9} title="API and programmatic access">
          <p>
            We offer an API and a Model Context Protocol (MCP) server for
            approved applications and AI assistants. The same rules apply: the
            content served through them belongs to its publishers, attribution
            and links must be preserved, and the access is rate-limited. Access
            can be withdrawn if it is used to republish rather than to point at
            the source.
          </p>
        </Section>

        <Section n={10} title="Availability">
          <p>
            The service is provided &ldquo;as is&rdquo;. We do not guarantee
            that it will be uninterrupted, complete or error-free, that any
            particular publisher will be available through it, or that any
            article will remain reachable — publishers change and remove their
            own material, and we follow them.
          </p>
        </Section>

        <Section n={11} title="Limitation of liability">
          <p>
            To the extent permitted by law, Nyuchi Africa is not liable for
            indirect, incidental, special or consequential loss arising from
            your use of Mukoko News, or for any loss arising from content
            published by a third party and indexed here.
          </p>
        </Section>

        <Section n={12} title="Changes to these terms">
          <p>
            We may update these terms. The date at the top always reflects the
            current version, and we will ask you to accept again where a change
            is material. Continued use after a change means you accept it.
          </p>
        </Section>

        <Section n={13} title="Contact">
          <p>
            Questions about these terms, or a rights or removal request:{" "}
            <a
              href="mailto:legal@mukoko.com"
              className="text-primary hover:underline"
            >
              legal@mukoko.com
            </a>
            .
          </p>
        </Section>
      </div>
    </PageContainer>
  );
}
