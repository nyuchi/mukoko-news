import {
  BASE_URL,
  COUNTRIES,
} from "@/lib/constants";
import { SoftwareApplicationJsonLd } from "@/components/ui/json-ld";
import { getLiveCoverageAction } from "@/lib/actions/coverage";

function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-surface border border-border">
      {label && (
        <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border bg-elevated">
          {label}
        </div>
      )}
      <div className="p-4">
        <pre className="overflow-x-auto text-sm">
          <code className="font-mono">{children}</code>
        </pre>
      </div>
    </div>
  );
}

function ParamRow({
  name,
  type,
  defaultVal,
  description,
}: {
  name: string;
  type: string;
  defaultVal: string;
  description: string;
}) {
  return (
    <tr className="border-b border-border">
      <td className="py-2.5 pr-4 font-mono text-xs text-primary">{name}</td>
      <td className="py-2.5 pr-4 text-xs text-text-tertiary">{type}</td>
      <td className="py-2.5 pr-4 font-mono text-xs">{defaultVal}</td>
      <td className="py-2.5 text-sm text-text-secondary">{description}</td>
    </tr>
  );
}

export default async function EmbedPage() {
  // The live countries, not the whole scope: a developer copying a code out of
  // this table expects articles back, and an in-scope-but-unreleased country
  // renders an empty widget.
  const coverage = await getLiveCoverageAction();
  const countryCodes = coverage.codes.join(", ");
  const liveCodes = new Set(coverage.codes);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <SoftwareApplicationJsonLd coverage={coverage} />
      {/* Hero */}
      <h1 className="font-heading text-3xl font-bold">
        Embed Location News Cards
      </h1>
      <p className="mt-4 text-text-secondary max-w-2xl">
        Add live, location-based African news to any website or app. Embeddable
        news cards for top stories, featured content and local news &mdash; live in{" "}
        {coverage.count} African countries, with all {coverage.scopeTotal} in scope.
        Free, no API key required.
      </p>

      {/* Quick start — Script Widget */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Quick Start — Script Widget</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Drop this snippet anywhere in your HTML. The widget auto-creates an
          iframe sized to the layout you choose.
        </p>
        <CodeBlock label="HTML">{`<!-- Mukoko News Embed -->
<div data-mukoko-embed
     data-country="ZW"
     data-type="top"
     data-layout="cards">
</div>
<script src="${BASE_URL}/embed/widget.js" async></script>`}</CodeBlock>
      </section>

      {/* iframe Embed */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Direct iframe Embed</h2>
        <p className="mt-2 text-sm text-text-secondary">
          For full control, use the iframe URL directly with query parameters.
        </p>
        <CodeBlock label="HTML">{`<iframe
  src="${BASE_URL}/embed/iframe?country=KE&type=top&layout=cards&limit=6"
  width="420"
  height="600"
  frameborder="0"
  title="Kenya Top Stories — Mukoko News"
  style="border-radius: 12px; border: 1px solid #e5e5e5; max-width: 100%;"
></iframe>`}</CodeBlock>
      </section>

      {/* Parameters */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Parameters</h2>
        <p className="mt-2 text-sm text-text-secondary">
          All parameters work with both the script widget (as{" "}
          <code className="text-primary font-mono text-xs">data-*</code> attributes) and the
          iframe URL (as query params).
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-semibold">Param</th>
                <th className="pb-2 pr-4 font-semibold">Type</th>
                <th className="pb-2 pr-4 font-semibold">Default</th>
                <th className="pb-2 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="text-text-secondary">
              <ParamRow
                name="country"
                type="string"
                defaultVal="ZW"
                description={`Country code for location filtering. Live: ${countryCodes}. The other ${coverage.scopeTotal - coverage.count} African Union member states are accepted but have no articles yet.`}
              />
              <ParamRow
                name="type"
                type="enum"
                defaultVal="latest"
                description="Feed type — top (trending), featured (popular), latest (newest), location (local news)"
              />
              <ParamRow
                name="layout"
                type="enum"
                defaultVal="cards"
                description="Visual layout — cards (grid), compact (text list), hero (single large card), ticker (horizontal scroll), list (thumbnail list)"
              />
              <ParamRow
                name="limit"
                type="number"
                defaultVal="varies"
                description="Number of articles (1-20). Defaults: cards=6, compact=8, hero=1, ticker=10, list=10"
              />
              <ParamRow
                name="category"
                type="string"
                defaultVal="—"
                description="Filter by category slug (politics, economy, sports, technology, etc.)"
              />
              <ParamRow
                name="theme"
                type="enum"
                defaultVal="auto"
                description="Force a theme — light, dark, or auto (matches parent page)"
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* Layout Examples */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Layout Examples</h2>

        {/* Cards */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold">Cards Grid</h3>
          <p className="text-sm text-text-secondary mt-1">
            Visual card grid with images — ideal for sidebars and content areas.
          </p>
          <CodeBlock label="Example">{`<div data-mukoko-embed data-country="ZW" data-type="top" data-layout="cards" data-limit="4"></div>`}</CodeBlock>
          <div className="mt-4 flex justify-center">
            <iframe
              src={`${BASE_URL}/embed/iframe?country=ZW&type=top&layout=cards&limit=4`}
              width="420"
              height="520"
              title="Cards Layout — Zimbabwe Top Stories"
              className="rounded-2xl border border-border"
            />
          </div>
        </div>

        {/* Hero */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold">Hero Card</h3>
          <p className="text-sm text-text-secondary mt-1">
            Single featured story with large image — great for ad-like placements and promotions.
          </p>
          <CodeBlock label="Example">{`<div data-mukoko-embed data-country="KE" data-type="featured" data-layout="hero"></div>`}</CodeBlock>
          <div className="mt-4 flex justify-center">
            <iframe
              src={`${BASE_URL}/embed/iframe?country=KE&type=featured&layout=hero`}
              width="420"
              height="340"
              title="Hero Layout — Kenya Featured Story"
              className="rounded-2xl border border-border"
            />
          </div>
        </div>

        {/* Compact */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold">Compact List</h3>
          <p className="text-sm text-text-secondary mt-1">
            Text-focused list — minimal footprint for narrow sidebars and sister app integration.
          </p>
          <CodeBlock label="Example">{`<div data-mukoko-embed data-country="NG" data-type="latest" data-layout="compact" data-limit="5"></div>`}</CodeBlock>
          <div className="mt-4 flex justify-center">
            <iframe
              src={`${BASE_URL}/embed/iframe?country=NG&type=latest&layout=compact&limit=5`}
              width="360"
              height="420"
              title="Compact Layout — Nigeria Latest News"
              className="rounded-2xl border border-border"
            />
          </div>
        </div>

        {/* Ticker */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold">Ticker (Horizontal Scroll)</h3>
          <p className="text-sm text-text-secondary mt-1">
            Horizontal scrollable strip — perfect for headers, footers, and banner placements.
          </p>
          <CodeBlock label="Example">{`<div data-mukoko-embed data-country="ZA" data-type="top" data-layout="ticker" data-limit="8"></div>`}</CodeBlock>
          <div className="mt-4">
            <iframe
              src={`${BASE_URL}/embed/iframe?country=ZA&type=top&layout=ticker&limit=8`}
              width="100%"
              height="200"
              title="Ticker Layout — South Africa Top Stories"
              className="rounded-2xl border border-border"
            />
          </div>
        </div>

        {/* List */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold">Thumbnail List</h3>
          <p className="text-sm text-text-secondary mt-1">
            Classic list with thumbnails — the default feed-style embed.
          </p>
          <CodeBlock label="Example">{`<div data-mukoko-embed data-country="GH" data-type="latest" data-layout="list" data-limit="5"></div>`}</CodeBlock>
          <div className="mt-4 flex justify-center">
            <iframe
              src={`${BASE_URL}/embed/iframe?country=GH&type=latest&layout=list&limit=5`}
              width="400"
              height="520"
              title="List Layout — Ghana Latest News"
              className="rounded-2xl border border-border"
            />
          </div>
        </div>
      </section>

      {/* Location-Based News */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Location-Based News</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Location-based embeds are critical for sister apps and regional content.
          Use the <code className="text-primary font-mono text-xs">country</code> parameter
          to target any of the {coverage.count} live African countries below. The
          remaining {coverage.scopeTotal - coverage.count} African Union member states
          are in scope and coming soon &mdash; the parameter accepts them, but there are no
          articles behind them yet.
        </p>
        <div className="mt-4 grid grid-cols-4 sm:grid-cols-8 gap-2">
          {COUNTRIES.filter((c) => liveCodes.has(c.code)).map((c) => (
            <div key={c.code} className="flex flex-col items-center gap-1 p-2 rounded-xl bg-surface border border-border text-center">
              <span className="text-lg">{c.flag}</span>
              <span className="text-[10px] font-semibold">{c.code}</span>
            </div>
          ))}
        </div>
        <CodeBlock label="Kenya Location News">{`<div data-mukoko-embed
     data-country="KE"
     data-type="location"
     data-layout="cards"
     data-limit="4">
</div>`}</CodeBlock>
      </section>

      {/* Integration with Sister Apps */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Sister App Integration</h2>
        <p className="mt-2 text-sm text-text-secondary">
          For embedding in other Mukoko apps (Weather, Sports, etc.), use the
          script widget. It handles responsive sizing and theme matching.
        </p>
        <CodeBlock label="weather.mukoko.com example">{`<!-- In your app's sidebar or content area -->
<div data-mukoko-embed
     data-country="ZW"
     data-type="location"
     data-layout="compact"
     data-limit="5"
     data-theme="dark">
</div>
<script src="${BASE_URL}/embed/widget.js" async></script>`}</CodeBlock>
      </section>

      {/* Features */}
      <section className="mt-12 mb-12">
        <h2 className="text-xl font-semibold">Features</h2>
        <ul className="mt-4 space-y-2 text-sm text-text-secondary list-disc pl-5">
          <li>
            Location-based news from {coverage.count} live African countries (
            {coverage.scopeTotal} in scope)
          </li>
          <li>4 feed types: Top Stories, Featured, Latest, Location</li>
          <li>5 visual layouts: Cards, Compact, Hero, Ticker, List</li>
          <li>Category filtering (politics, sports, economy, tech, etc.)</li>
          <li>Auto-refreshes every 5 minutes</li>
          <li>Respects system dark/light theme or forced via parameter</li>
          <li>Links open in a new tab (won&apos;t navigate away from your page)</li>
          <li>Sandboxed iframes for security</li>
          <li>Lightweight widget script — under 2 KB</li>
          <li>No API key required</li>
        </ul>
      </section>
    </div>
  );
}
