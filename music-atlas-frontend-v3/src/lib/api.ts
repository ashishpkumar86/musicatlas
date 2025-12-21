export type ApiOptions = RequestInit;

export class ApiError extends Error {
  status: number;
  bodySnippet: string;
  contentType: string;
  isHtml: boolean;
  url: string;

  constructor({
    message,
    status,
    bodySnippet,
    contentType,
    isHtml,
    url
  }: {
    message: string;
    status: number;
    bodySnippet: string;
    contentType: string;
    isHtml: boolean;
    url: string;
  }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.contentType = contentType;
    this.isHtml = isHtml;
    this.url = url;
  }
}

const normalizePath = (path: string) => {
  if (!path) return '/api';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return path;
  return `/${path}`;
};

const readBodySafe = async (res: Response) => {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const isHtml = contentType.includes('text/html');
  const text = await res.text();

  if (res.ok) {
    if (isJson) {
      try {
        return { data: JSON.parse(text) as unknown, contentType, isHtml: false };
      } catch (err) {
        console.warn('Failed to parse JSON response', err);
      }
    }
    return { data: text as unknown, contentType, isHtml };
  }

  const bodySnippet = text ? text.slice(0, 500) : '';
  const looksHtml = isHtml || /<!doctype html|<html/i.test(bodySnippet);
  return { errorText: text, contentType, isHtml: looksHtml, bodySnippet };
};

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = normalizePath(path);
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      ...(options.headers || {})
    }
  });

  const body = await readBodySafe(res);

  if (!res.ok) {
    const message = body?.isHtml
      ? 'API route returned HTML. Check /api proxy configuration.'
      : body?.bodySnippet || `Request failed with status ${res.status}`;
    throw new ApiError({
      message,
      status: res.status,
      bodySnippet: body?.bodySnippet || '',
      contentType: body?.contentType || '',
      isHtml: Boolean(body?.isHtml),
      url
    });
  }

  return body?.data as T;
}
