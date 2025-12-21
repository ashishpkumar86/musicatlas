import type { Metadata } from 'next';
import './globals.css';
import { VariantProvider } from '@/components/variant-provider';

export const metadata: Metadata = {
  title: 'Personalized recommendations from The Music Atlas',
  description: 'Listening Map and Constellations UI using mock data.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-canvas text-textPrimary">
        <VariantProvider>
          <div className="min-h-screen bg-gradient-to-b from-canvas via-canvas to-black/70">
            <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
          </div>
        </VariantProvider>
      </body>
    </html>
  );
}
