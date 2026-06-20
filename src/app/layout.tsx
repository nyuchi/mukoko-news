import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { BottomNav } from '@/components/layout/bottom-nav';
import { OnboardingModal } from '@/components/onboarding-modal';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/ui/json-ld';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';

// Fonts are loaded via CSS @import in globals.css for better reliability
// This avoids build failures when Google Fonts API is unreachable

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
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF9F5' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Preconnect to Google Fonts for faster font loading */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
            <main className="flex-1 relative z-10 pb-16 md:pb-0">{children}</main>
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
