'use client';

import Link from 'next/link';
import { SourceLoginPanel } from '@/components/source-login-panel';

export default function IngestPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.25em] text-textMuted">Seeds and sessions</p>
          <h2 className="text-3xl font-semibold text-textPrimary">Connect Spotify and TIDAL</h2>
          <p className="text-sm text-textMuted">
            Uses the same login endpoints as the existing frontend. Calls go through same-origin <code>/api/*</code>.
          </p>
        </div>
        <Link href="/" className="text-sm text-accent hover:text-accentMuted">
          &larr; Landing
        </Link>
      </div>

      <div className="card-surface p-4 text-sm text-textMuted">
        <p className="mb-2 font-semibold text-textPrimary">Instructions</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Update your Spotify/TIDAL callback URLs to use port 3000 (e.g., http://127.0.0.1:3000/auth/... if needed).</li>
          <li>Ensure the backend is running and CORS allows http://localhost:3000.</li>
          <li>This page will redirect directly to backend login endpoints; session cookies are required.</li>
        </ul>
      </div>

      <SourceLoginPanel />
    </div>
  );
}
