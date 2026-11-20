import type { ApiErrorBody } from '@/types/api';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

/** Every failure becomes one of these; the UI never sees a raw exception or a stack trace. */
export class ApiClientError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status: number = 0,
    public code: string = kind.toUpperCase(),
    public recoverable: boolean = true,
    public retryable: boolean = kind !== 'http',
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
  /** True when the backend itself could not be reached (as opposed to it answering with an error). */
  get unreachable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

export type FetchLike = (url: string, init?: any) => Promise<Response>;

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ApiClient {
  constructor(
    private getBaseUrl: () => string,
    private fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private defaultTimeoutMs = 8000,
  ) {}

  get baseUrl(): string {
    return this.getBaseUrl();
  }

  async request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    opts.signal?.addEventListener('abort', () => controller.abort());
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.getBaseUrl()}${path}`, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new ApiClientError('timeout', 'The backend did not answer in time.');
      throw new ApiClientError('network', 'Could not reach the backend.');
    } finally {
      clearTimeout(timer);
    }
    let payload: unknown = null;
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (res.ok) throw new ApiClientError('parse', 'The backend sent an unreadable response.', res.status);
      }
    }
    if (!res.ok) {
      const env = (payload as ApiErrorBody | null)?.error;
      if (env && typeof env.code === 'string') {
        throw new ApiClientError('http', env.message, res.status, env.code, env.recoverable, env.retryable, env.details ?? {});
      }
      throw new ApiClientError('http', `The backend returned an error (${res.status}).`, res.status, 'HTTP_ERROR', true, res.status >= 500);
    }
    return payload as T;
  }

  get<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, undefined, opts);
  }
  post<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, body ?? {}, opts);
  }
}
