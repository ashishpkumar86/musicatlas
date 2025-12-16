# Music Atlas Frontend v3 (mock)

New Next.js + Tailwind + TypeScript UI for the Listening Map and Constellation Explorer. Uses mock data only so the existing frontend (login + favorites) stays untouched.

## Getting started

1. Install Node 18+ (npm).
2. `npm install`
3. `npm run dev` and open http://localhost:3000

## Backend callbacks

- Set `NEXT_PUBLIC_API_BASE_URL` to your backend origin (defaults to http://localhost:8000).
- Update Spotify/TIDAL callback URLs to use port 3000 (e.g., http://127.0.0.1:3000/auth/...).
- `/ingest` uses the existing `/auth/{provider}` and `/spotify/*`/`/tidal/*` endpoints with `credentials: include` cookies.

## Notes

- Mock variants (normal | loading | empty | partial | error) are switchable from the header toggle.  
- Mock data lives in `src/mock/userMap.ts` and is the only data source right now.  
- Replace `getMockUserMap` with real endpoints when backend is ready.
