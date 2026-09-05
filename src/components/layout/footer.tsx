"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AppIcon } from "@/components/ui/app-icon";

// Footer links
const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/help", label: "Help" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

// Mukoko News configuration
const APP_CONFIG = {
  name: "mukoko news",
  tagline: "Pan-African Digital News",
  mukokoUrl: "https://mukoko.com",
  copyrightHolder: "Nyuchi Africa",
};

export function Footer() {
  const pathname = usePathname();

  // Hide footer on NewsBytes for immersive experience
  if (pathname === "/newsbytes") {
    return null;
  }

  return (
    <footer className="border-t border-elevated py-12 mt-20">
      <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <AppIcon size={28} className="shadow-sm" />
          <span className="text-xl font-bold text-primary">{APP_CONFIG.name}</span>
          <span className="font-serif italic text-sm text-text-secondary hidden sm:inline">
            &ldquo;{APP_CONFIG.tagline}&rdquo;
          </span>
        </div>

        {/* Links */}
        <nav aria-label="Footer" className="flex flex-wrap justify-center gap-8">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-text-secondary hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right: Theme Toggle + Attribution */}
        <div className="flex items-center gap-4 text-xs text-text-tertiary whitespace-nowrap">
          <ThemeToggle />
          <span>
            A{" "}
            <Link href={APP_CONFIG.mukokoUrl} className="text-secondary font-medium hover:underline">
              Mukoko
            </Link>{" "}
            Product
          </span>
          <span>© {new Date().getFullYear()} {APP_CONFIG.copyrightHolder}</span>
        </div>
      </div>
    </footer>
  );
}
