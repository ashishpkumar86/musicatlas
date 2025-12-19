import type { Metadata } from 'next';
import './globals.css';
import { VariantProvider } from '@/components/variant-provider';

export const metadata: Metadata = {
  title: 'Music Atlas v3 Preview',
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
            <header className="sticky top-0 z-30 border-b border-white/5 bg-canvas/80 backdrop-blur">
              <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-accent">Music Atlas</p>
                  <h1 className="text-xl font-semibold text-textPrimary">v3 UI Preview</h1>
                </div>
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
          </div>
        </VariantProvider>
      </body>
    </html>
  );
}
