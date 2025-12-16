import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-white/5 bg-panel/70 p-10 shadow-xl shadow-black/40">
      <p className="text-sm uppercase tracking-[0.25em] text-accent">Preview</p>
      <h2 className="text-3xl font-semibold text-textPrimary">This is the new UI preview (mock data)</h2>
      <p className="max-w-2xl text-lg text-textMuted">
        Constellations, tags, and recommendations are mocked so we can design the Listening Map and Constellation Explorer
        without touching the live login and favorites experience.
      </p>
      <div className="flex gap-4">
        <Link
          href="/map"
          className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-canvas transition hover:bg-accentMuted"
        >
          Go to Listening Map
        </Link>
        <span className="flex items-center rounded-full bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-textMuted">
          UI-only - OAuth not wired yet
        </span>
      </div>
      <div className="flex gap-4">
        <Link
          href="/ingest"
          className="inline-flex items-center justify-center rounded-full border border-white/10 px-4 py-2 text-sm text-textMuted transition hover:border-accent hover:text-textPrimary"
        >
          Spotify + TIDAL login (backend)
        </Link>
      </div>
    </div>
  );
}
