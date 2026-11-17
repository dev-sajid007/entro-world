import type { ApiErrorBody, AuthTokenResponse } from "@entroworld/shared";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Per-field validation messages, when the server sent them. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Listener = (session: AuthTokenResponse | null) => void;

/**
 * Talks to the REST API. The access token lives only in memory; the refresh token is an httpOnly
 * cookie scoped to /api/v1/auth, so scripts on the page can never read it.
 */
class ApiClient {
  private session: AuthTokenResponse | null = null;
  private refreshing: Promise<AuthTokenResponse | null> | null = null;
  private readonly listeners = new Set<Listener>();

  get current(): AuthTokenResponse | null {
    return this.session;
  }

  onSession(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSession(session: AuthTokenResponse | null): void {
    this.session = session;
    for (const l of this.listeners) l(session);
  }

  /** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
  refresh(): Promise<AuthTokenResponse | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthTokenResponse | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const session = (await res.json()) as AuthTokenResponse;
        this.setSession(session);
        return session;
      }
      // Another tab rotated the cookie a moment ago; the browser now holds the new one.
      if (res.status === 409) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      if (res.status >= 500) throw await toError(res);
      this.setSession(null);
      return null;
    }
    this.setSession(null);
    return null;
  }

  async request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.session) headers.authorization = `Bearer ${this.session.accessToken}`;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 && this.session && !retried) {
      const error = await toError(res);
      if (error.code === "token_expired" || error.code === "invalid_token") {
        if (await this.refresh()) return this.request<T>(method, path, body, true);
      }
      this.setSession(null);
      throw error;
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204 || res.status === 202) return undefined as T;
    return (await res.json()) as T;
  }

  get = <T>(path: string) => this.request<T>("GET", path);
  post = <T>(path: string, body?: unknown) => this.request<T>("POST", path, body ?? {});
  patch = <T>(path: string, body: unknown) => this.request<T>("PATCH", path, body);
  put = <T>(path: string, body: unknown) => this.request<T>("PUT", path, body);
  delete = <T>(path: string) => this.request<T>("DELETE", path);
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    const details = body.error.details as { fields?: Record<string, string> } | undefined;
    return new ApiError(res.status, body.error.code, body.error.message, details?.fields ?? {});
  } catch {
    return new ApiError(res.status, "network_error", res.status >= 500 ? "The server is unavailable. Try again shortly." : `Request failed (${res.status})`);
  }
}

export const api = new ApiClient();

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong");
