import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/lib/auth-context';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/ui/json-ld';

// Fonts are loaded via CSS @import in globals.css for better reliability
// This avoids build failures when Google Fonts API is unreachable

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://news.mukoko.com';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Mukoko News Console',
    template: '%s | Mukoko News',
  },
  description: 'Pan-African news processing and management console. Publisher onboarding, content moderation, API management, and admin tools for Mukoko News.',
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
    title: 'Mukoko News Console',
    description: 'Pan-African news processing and management console. Publisher onboarding, content moderation, API management, and admin tools.',
    url: BASE_URL,
    siteName: 'Mukoko News',
    images: [
      {
        url: '/mukoko-icon-dark.png',
        width: 512,
        height: 512,
        alt: 'Mukoko News Console',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Mukoko News Console',
    description: 'Pan-African news processing and management console.',
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
        <ThemeProvider defaultTheme="system" storageKey="mukoko-news-theme">
          <AuthProvider>
            {/* Five African Minerals vertical stripe */}
            <div className="minerals-stripe" />

            <Header />
            <main className="flex-1 relative z-10">{children}</main>
            <Footer />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
