"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Newspaper,
  Building2,
  PenTool,
  Wrench,
  Code2,
  Rss,
  MonitorPlay,
  Menu,
  X,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { AppIcon } from "@/components/ui/app-icon";

const platformNav = [
  {
    label: "Overview",
    items: [
      { href: "/platform", label: "Dashboard", icon: LayoutDashboard },
      { href: "/platform/feed", label: "Public Feed", icon: Newspaper },
    ],
  },
  {
    label: "Publishing",
    items: [
      { href: "/platform/publishers", label: "Publishers", icon: Building2 },
      { href: "/platform/authors", label: "Authors", icon: PenTool },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/platform/tools", label: "All Tools", icon: Wrench },
      { href: "/platform/tools/embed", label: "Embed Widgets", icon: MonitorPlay },
      { href: "/platform/tools/mcp", label: "MCP Server", icon: Code2 },
      { href: "/platform/tools/rss", label: "RSS Feeds", icon: Rss },
    ],
  },
];

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/platform") return pathname === "/platform";
    return pathname.startsWith(href);
  };

  const sidebar = (
    <nav className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <Link href="/platform" className="flex items-center gap-2.5">
          <AppIcon size={28} />
          <div>
            <span className="text-sm font-bold text-primary block leading-tight">
              mukoko news
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              Platform
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {platformNav.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary hover:text-foreground hover:bg-elevated"
                    }`}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                    {active && (
                      <ChevronRight className="w-3.5 h-3.5 ml-auto text-primary/60" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer links */}
      <div className="px-3 py-4 border-t border-border space-y-1">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          <span>Mukoko News App</span>
        </Link>
        <Link
          href="/admin"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Admin Dashboard</span>
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[260px] flex-col bg-surface border-r border-border shrink-0 sticky top-0 h-screen">
        {sidebar}
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-[280px] h-full bg-surface shadow-xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-elevated"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-elevated"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link href="/platform" className="flex items-center gap-2">
              <AppIcon size={24} />
              <span className="text-sm font-bold text-primary">
                mukoko news
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Platform
              </span>
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
