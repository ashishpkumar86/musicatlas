const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

type ApiOptions = RequestInit & { skipAuth?: boolean };

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const base = DEFAULT_API_BASE.replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    credentials: options.skipAuth ? 'same-origin' : 'include',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }

  // Fallback to text for non-JSON responses
  return res.text() as unknown as T;
}

export const apiBase = DEFAULT_API_BASE;
