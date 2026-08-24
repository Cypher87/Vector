import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Vector — Live ADS-B Radar',
  description: 'Een rustige, moderne live radarinterface voor readsb.',
  openGraph: {
    title: 'Vector',
    description: 'Live ADS-B radar',
    images: [{ url: '/og.png', width: 1732, height: 909, alt: 'Vector — Live ADS-B radar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vector',
    description: 'Live ADS-B radar',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
