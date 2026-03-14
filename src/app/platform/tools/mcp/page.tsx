"use client";

import { useState } from "react";
import {
  Code2,
  Terminal,
  BookOpen,
  Wrench,
  Database,
  Search,
  Newspaper,
  TrendingUp,
  Zap,
  Copy,
  CheckCircle2,
  Globe,
  Tag,
  Radio,
} from "lucide-react";

function CodeBlock({
  children,
  label,
  copyable = true,
}: {
  children: string;
  label?: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) {
        const textArea = document.createElement("textarea");
        textArea.value = children;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      } else {
        await navigator.clipboard.writeText(children);
      }
      setCopied(true);
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    } catch {
      // Copy failed silently
    }
  };

  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-surface border border-border">
      {(label || copyable) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-elevated">
          {label && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {label}
            </span>
          )}
          {copyable && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-primary transition-colors"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-green-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
      <div className="p-4">
        <pre className="overflow-x-auto text-sm">
          <code className="font-mono text-text-secondary">{children}</code>
        </pre>
      </div>
    </div>
  );
}

const tools = [
  {
    name: "search_articles",
    icon: Search,
    description: "Search articles — returns SearchResponse",
    params: "query, country?, category?, limit?",
  },
  {
    name: "get_latest_articles",
    icon: Newspaper,
    description: "List articles — returns ArticleListResponse",
    params: "country?, category?, sort?, limit?",
  },
  {
    name: "get_article",
    icon: BookOpen,
    description: "Get full article — returns ArticleFull",
    params: "articleId",
  },
  {
    name: "get_trending",
    icon: TrendingUp,
    description: "Trending story clusters — returns TrendingResponse",
    params: "country?, limit?, hours?",
  },
  {
    name: "get_news_bytes",
    icon: Zap,
    description: "Short-form news — returns ArticleListResponse",
    params: "country?, category?, limit?",
  },
  {
    name: "get_related_articles",
    icon: Database,
    description: "Related articles — returns RelatedArticlesResponse",
    params: "articleId",
  },
  {
    name: "list_sources",
    icon: Radio,
    description: "All news sources — returns SourcesResponse",
    params: "(none)",
  },
  {
    name: "get_stats",
    icon: TrendingUp,
    description: "Platform statistics — returns StatsResponse",
    params: "(none)",
  },
  {
    name: "get_keywords",
    icon: Tag,
    description: "Get trending keywords and discussion topics",
    params: "limit?",
  },
];

const resources = [
  {
    uri: "mukoko://openapi",
    icon: Code2,
    description: "OpenAPI 3.0 schema reference — all models and endpoints",
  },
  {
    uri: "mukoko://countries",
    icon: Globe,
    description: "CountriesResponse — all 16 supported African countries",
  },
  {
    uri: "mukoko://categories",
    icon: Tag,
    description: "CategoriesResponse — news categories with article counts",
  },
  {
    uri: "mukoko://sources",
    icon: Radio,
    description: "SourcesResponse — all news sources with health status",
  },
  {
    uri: "mukoko://keywords",
    icon: TrendingUp,
    description: "KeywordsResponse — trending keywords and topics",
  },
];

const claudeDesktopConfig = `{
  "mcpServers": {
    "mukoko-news": {
      "command": "node",
      "args": ["path/to/mukoko-news/mcp-server/src/index.js"],
      "env": {
        "MUKOKO_API_SECRET": "your-api-secret"
      }
    }
  }
}`;

const claudeCodeConfig = `claude mcp add mukoko-news \\
  node path/to/mukoko-news/mcp-server/src/index.js \\
  -e MUKOKO_API_SECRET=your-api-secret`;

const cursorConfig = `{
  "mcpServers": {
    "mukoko-news": {
      "command": "node",
      "args": ["path/to/mukoko-news/mcp-server/src/index.js"],
      "env": {
        "MUKOKO_API_SECRET": "your-api-secret"
      }
    }
  }
}`;

const exampleUsage = `# Example prompts to use with the MCP server:

"What are the trending stories in Zimbabwe today?"
→ Uses: get_trending(country: "ZW")

"Search for articles about climate change in Kenya"
→ Uses: search_articles(query: "climate change", country: "KE")

"Give me the latest technology news from Nigeria"
→ Uses: get_latest_articles(country: "NG", category: "technology")

"What are the top keywords being discussed?"
→ Uses: get_keywords(limit: 20)

"Get the full content of article abc123"
→ Uses: get_article(id: "abc123")`;

export default function ToolsMcpPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center">
            <Code2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">MCP Server</h1>
            <p className="text-sm text-text-tertiary">
              Model Context Protocol for AI-powered news workflows
            </p>
          </div>
        </div>
        <p className="text-text-secondary max-w-2xl mt-4">
          The Mukoko News MCP server lets any MCP-compatible AI client — Claude
          Desktop, Claude Code, Cursor, and others — query Pan-African news
          articles, search by topic, get trending stories, and browse news
          sources directly from your AI assistant.
        </p>
      </div>

      {/* Quick Setup */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Quick Setup
          </h2>
        </div>

        <div className="space-y-3">
          <div className="p-4 bg-surface rounded-xl border border-border">
            <p className="text-sm font-medium text-foreground mb-1">
              1. Install dependencies
            </p>
            <CodeBlock label="Terminal">{`cd mcp-server && npm install`}</CodeBlock>
          </div>

          <div className="p-4 bg-surface rounded-xl border border-border">
            <p className="text-sm font-medium text-foreground mb-1">
              2. Configure your AI client (see below)
            </p>
          </div>

          <div className="p-4 bg-surface rounded-xl border border-border">
            <p className="text-sm font-medium text-foreground mb-1">
              3. Start using — ask your AI about African news
            </p>
          </div>
        </div>
      </section>

      {/* Client Configuration */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Client Configuration
          </h2>
        </div>

        {/* Claude Desktop */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Claude Desktop
          </h3>
          <p className="text-xs text-text-secondary mb-2">
            Add to{" "}
            <code className="text-primary font-mono">
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </code>
          </p>
          <CodeBlock label="claude_desktop_config.json">
            {claudeDesktopConfig}
          </CodeBlock>
        </div>

        {/* Claude Code */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Claude Code (CLI)
          </h3>
          <CodeBlock label="Terminal">{claudeCodeConfig}</CodeBlock>
        </div>

        {/* Cursor */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Cursor
          </h3>
          <p className="text-xs text-text-secondary mb-2">
            Add to{" "}
            <code className="text-primary font-mono">
              .cursor/mcp.json
            </code>{" "}
            in your project root
          </p>
          <CodeBlock label=".cursor/mcp.json">{cursorConfig}</CodeBlock>
        </div>
      </section>

      {/* Environment Variables */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Environment Variables
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-semibold">Variable</th>
                <th className="pb-2 pr-4 font-semibold">Required</th>
                <th className="pb-2 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="text-text-secondary">
              <tr className="border-b border-border">
                <td className="py-2.5 pr-4 font-mono text-xs text-primary">
                  MUKOKO_API_SECRET
                </td>
                <td className="py-2.5 pr-4 text-xs">Yes</td>
                <td className="py-2.5 text-sm">
                  API bearer token for authenticated access
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-2.5 pr-4 font-mono text-xs text-primary">
                  MUKOKO_API_URL
                </td>
                <td className="py-2.5 pr-4 text-xs">No</td>
                <td className="py-2.5 text-sm">
                  API base URL (defaults to production)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Available Tools */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Available Tools
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          These tools are available to your AI client when the MCP server is
          connected:
        </p>
        <div className="space-y-2">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="flex items-center gap-4 p-4 bg-surface rounded-xl border border-border"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <tool.icon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold text-foreground">
                  {tool.name}
                </p>
                <p className="text-xs text-text-secondary">
                  {tool.description}
                </p>
              </div>
              <code className="text-[10px] font-mono text-text-tertiary bg-elevated px-2 py-1 rounded shrink-0">
                {tool.params}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Available Resources */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Available Resources
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Static resources your AI client can read for context:
        </p>
        <div className="grid grid-cols-2 gap-3">
          {resources.map((resource) => (
            <div
              key={resource.uri}
              className="p-4 bg-surface rounded-xl border border-border"
            >
              <div className="flex items-center gap-2 mb-2">
                <resource.icon className="w-4 h-4 text-primary" />
                <code className="text-xs font-mono text-primary">
                  {resource.uri}
                </code>
              </div>
              <p className="text-xs text-text-secondary">
                {resource.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Example Usage */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Example Prompts
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-3">
          Once connected, just ask your AI assistant naturally:
        </p>
        <CodeBlock label="Examples" copyable={false}>
          {exampleUsage}
        </CodeBlock>
      </section>

      {/* Architecture Note */}
      <section className="p-6 bg-surface rounded-2xl border border-border">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
            <Code2 className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              How It Works
            </h3>
            <p className="text-sm text-text-secondary">
              The MCP server runs locally as a stdio process. It connects to the
              Mukoko News API (Cloudflare Workers backend) using your API secret.
              All data stays between your AI client and the Mukoko API — no
              third-party data sharing. The server is a lightweight Node.js
              process with zero external dependencies beyond the MCP SDK.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
