import type { Metadata, Viewport } from 'next';
import { Noto_Serif, Noto_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { BottomNav } from '@/components/layout/bottom-nav';
import { OnboardingModal } from '@/components/onboarding-modal';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/ui/json-ld';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';

// Fonts are self-hosted via next/font (downloaded at build time, served from
// /_next/static) — no render-blocking Google Fonts CSS request at runtime.
// The CSS variables below are wired to the --font-sans/serif/mono theme
// tokens in globals.css, so existing font-family rules keep working.
const notoSerif = Noto_Serif({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-noto-serif',
});

const notoSans = Noto_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://news.mukoko.com';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Mukoko News - Pan-African News Hub',
    template: '%s | Mukoko News',
  },
  description: 'Pan-African digital news aggregation platform. Your trusted source for breaking news, top stories, and in-depth coverage from Zimbabwe and 16 African countries.',
  keywords: [
    'African news',
    'Pan-African news',
    'Zimbabwe news',
    'Africa headlines',
    'breaking news Africa',
    'South Africa news',
    'Kenya news',
    'Nigeria news',
    'African politics',
    'African economy',
    'news aggregator',
  ],
  authors: [{ name: 'Nyuchi', url: 'https://nyuchi.com' }],
  creator: 'Nyuchi',
  publisher: 'Mukoko News',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'Mukoko News - Pan-African News Hub',
    description: 'Your trusted source for breaking news and top stories from across Africa. Coverage from Zimbabwe, South Africa, Kenya, Nigeria, and 12 more countries.',
    url: BASE_URL,
    siteName: 'Mukoko News',
    images: [
      {
        url: '/mukoko-icon-dark.png',
        width: 512,
        height: 512,
        alt: 'Mukoko News - Pan-African News Hub',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Mukoko News - Pan-African News Hub',
    description: 'Your trusted source for breaking news and top stories from across Africa.',
    images: ['/mukoko-icon-dark.png'],
    site: '@mukokoafrica',
    creator: '@mukokoafrica',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: BASE_URL,
  },
  category: 'news',
  classification: 'News Aggregator',
  referrer: 'origin-when-cross-origin',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon.ico', sizes: '48x48' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#4B0082',
  // Required for env(safe-area-inset-*) to be non-zero on iOS — the floating
  // bottom nav offsets itself above the home-indicator swipe zone with it.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${notoSerif.variable} ${notoSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Fonts are self-hosted via next/font — no Google Fonts preconnect needed */}
        {/* Theme bootstrap: applies the stored theme class before first paint so
            ThemeProvider can render SSR HTML without a wrong-theme flash.
            Static script (no interpolation); key must match ThemeProvider's
            storageKey ("mukoko-news-theme"). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('mukoko-news-theme');var d=t==='light'?false:t==='dark'?true:window.matchMedia('(prefers-color-scheme: dark)').matches;var c=document.documentElement.classList;c.remove('light','dark');c.add(d?'dark':'light');}catch(e){}})()",
          }}
        />
        <OrganizationJsonLd />
        <WebSiteJsonLd />
      </head>
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <AuthKitProvider>
        <ThemeProvider defaultTheme="system" storageKey="mukoko-news-theme">
          <PreferencesProvider>
            {/* Five African Minerals vertical stripe */}
            <div className="minerals-stripe" />

            <Header />
            {/* Bottom padding on mobile keeps the floating nav pill from
                covering the last row of content (nav height + lift + safe area) */}
            <main className="flex-1 relative z-10 pb-[calc(env(safe-area-inset-bottom,0px)_+_5.5rem)] md:pb-0">
              {children}
            </main>
            <Footer />
            <BottomNav />

            {/* Onboarding Modal */}
            <OnboardingModal />
          </PreferencesProvider>
        </ThemeProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
