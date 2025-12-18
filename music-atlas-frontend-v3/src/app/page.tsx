import Link from 'next/link';
import { SpotifyRecsPanel } from '@/components/spotify-recs-panel';

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/map"
          className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-canvas transition hover:bg-accentMuted"
        >
          Go to Listening Map
        </Link>
        <Link
          href="/data-check"
          className="inline-flex items-center justify-center rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-textPrimary transition hover:border-accent hover:text-canvas hover:bg-accent/80"
        >
          Data capture tables
        </Link>
      </div>

      <section className="flex flex-col gap-4">
        <SpotifyRecsPanel />
      </section>
    </div>
  );
}
