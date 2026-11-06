import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/lib/wallet';
import './globals.css';

const sans = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans-face' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono-face' });

export const metadata: Metadata = {
  title: 'Dues · one checkout button, any chain, USDC on NEAR',
  description:
    'A checkout button any site can embed: the buyer pays from any wallet and chain through NEAR Intents, the seller receives USDC on NEAR. Recurring invoices for freelancers built on top.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f5f7f9' };

// Applied before paint so dark mode does not flash.
const themeScript = `try{var t=localStorage.getItem("dues-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
