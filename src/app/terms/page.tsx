import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Mukoko News, the Pan-African digital news aggregation platform by Nyuchi Africa. Read our terms of use, content policies, and user guidelines.",
  alternates: {
    canonical: getFullUrl("/terms"),
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function TermsPage() {
  return (
    <div className="max-w-[800px] mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Service</h1>
      <p className="text-text-secondary mb-8">Last updated: June 2026</p>

      <div className="prose prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
          <p className="text-text-secondary leading-relaxed">
            By accessing or using Mukoko News, you agree to be bound by these Terms of Service.
            If you do not agree to these terms, please do not use our service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">2. Description of Service</h2>
          <p className="text-text-secondary leading-relaxed">
            Mukoko News is a Pan-African digital news aggregation platform that collects and displays
            news content from various sources across Africa. We do not create original news content;
            we aggregate and curate articles from third-party publishers. The platform uses automated
            tools and artificial intelligence to categorize, enrich, and surface this content (see
            &ldquo;AI Features &amp; Automated Processing&rdquo; below), and offers an API and Model
            Context Protocol (MCP) interface for approved programmatic access (see &ldquo;API, MCP
            &amp; Programmatic Access&rdquo; below).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">
            3. AI Features &amp; Automated Processing
          </h2>
          <p className="text-text-secondary leading-relaxed mb-3">
            Mukoko News uses artificial intelligence and automated software agents to operate the
            service — including article classification, keyword and entity extraction, quality
            scoring, summarization, semantic search, and recommendations. By using the service you
            acknowledge that:
          </p>
          <ul className="list-disc list-inside text-text-secondary space-y-2">
            <li>
              AI-generated metadata, categories, tags, and summaries are produced by machines and may
              be inaccurate, incomplete, or out of date
            </li>
            <li>
              Automated agents process aggregated news content on a schedule; they do not replace the
              editorial judgment of the original publishers
            </li>
            <li>
              You should not rely on AI-generated summaries as a substitute for reading the original
              source article
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">
            4. API, MCP &amp; Programmatic Access
          </h2>
          <p className="text-text-secondary leading-relaxed mb-3">
            We offer a public API and a{" "}
            <a
              href="https://modelcontextprotocol.io"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Model Context Protocol (MCP)
            </a>{" "}
            server that allow approved applications and AI assistants to access published news
            content, briefings, and aggregate analytics. If you use these interfaces, you agree to:
          </p>
          <ul className="list-disc list-inside text-text-secondary space-y-2">
            <li>Authenticate as required and keep your access credentials and tokens secure</li>
            <li>Respect rate limits and not place an unreasonable load on our infrastructure</li>
            <li>
              Not use the API or MCP server to scrape, mirror, or redistribute content in bulk
              without a separate written agreement
            </li>
            <li>Comply with the attribution and intellectual-property terms in this document</li>
          </ul>
          <p className="text-text-secondary leading-relaxed mt-3">
            We may rate-limit, suspend, or revoke programmatic access that abuses the service or
            these terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">5. User Conduct</h2>
          <p className="text-text-secondary leading-relaxed mb-3">You agree not to:</p>
          <ul className="list-disc list-inside text-text-secondary space-y-2">
            <li>Use the service for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Interfere with the proper functioning of the service</li>
            <li>Scrape or collect data without permission</li>
            <li>Impersonate others or provide false information</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">6. Intellectual Property</h2>
          <p className="text-text-secondary leading-relaxed">
            News content displayed on Mukoko News remains the property of its respective publishers.
            The Mukoko News platform, branding, and design are owned by Nyuchi Africa. You may not
            reproduce, distribute, or create derivative works without permission.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">7. Third-Party Content</h2>
          <p className="text-text-secondary leading-relaxed">
            We aggregate content from third-party sources and are not responsible for the accuracy,
            completeness, or reliability of such content. Views expressed in articles are those of
            the original publishers.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">8. Disclaimer of Warranties</h2>
          <p className="text-text-secondary leading-relaxed">
            The service is provided &ldquo;as is&rdquo; without warranties of any kind. We do not guarantee
            uninterrupted or error-free service, and we are not liable for any damages arising from
            your use of the platform.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">9. Limitation of Liability</h2>
          <p className="text-text-secondary leading-relaxed">
            Nyuchi Africa shall not be liable for any indirect, incidental, special, or consequential
            damages arising from your use of Mukoko News.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">10. Changes to Terms</h2>
          <p className="text-text-secondary leading-relaxed">
            We reserve the right to modify these terms at any time. Continued use of the service
            after changes constitutes acceptance of the new terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-3">11. Contact</h2>
          <p className="text-text-secondary leading-relaxed">
            For questions about these terms, contact us at{" "}
            <a href="mailto:legal@mukoko.com" className="text-primary hover:underline">
              legal@mukoko.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
