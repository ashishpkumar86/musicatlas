import Link from 'next/link';
import { SourceLoginPanel } from '@/components/source-login-panel';

export default function Home() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
      <section className="card-surface flex flex-col gap-5 rounded-2xl border border-white/5 bg-panel/70 p-10 shadow-xl shadow-black/40">
        <p className="text-sm uppercase tracking-[0.25em] text-accent">Music Atlas</p>
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold leading-tight text-textPrimary">Sync your listening, jump into the map</h1>
          <p className="max-w-2xl text-lg text-textMuted">
            Connect Spotify or TIDAL to pull your top artists, then dive into the Listening Map to explore constellations and
            recommendations built around your taste.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
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
          <span className="flex items-center rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-textMuted">
            Map uses mock data today
          </span>
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-textMuted">
          Sync both providers to see their top 5 artists below. You can refresh anytime after connecting.
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SourceLoginPanel />
      </section>
    </div>
  );
}
