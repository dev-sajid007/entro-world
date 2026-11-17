import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { AuthTokenResponse, CurrentUser, RegisterResponse } from "@entroworld/shared";
import type { RegisterInput } from "@entroworld/validation";
import { WorldLoading } from "../world/WorldLayer";
import { api } from "../../lib/api";
import { queryClient } from "../../lib/queryClient";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthValue {
  status: AuthStatus;
  user: CurrentUser | null;
  login(login: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<RegisterResponse>;
  logout(): Promise<void>;
  /** Replaces the cached current user (after a profile edit). */
  setUser(user: CurrentUser): void;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthTokenResponse | null>(api.current);
  const [status, setStatus] = useState<AuthStatus>(api.current ? "authenticated" : "loading");

  useEffect(
    () =>
      api.onSession((s) => {
        setSession(s);
        setStatus(s ? "authenticated" : "anonymous");
        if (!s) queryClient.clear();
      }),
    [],
  );

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    if (api.current) return;
    api.refresh().catch(() => api.setSession(null));
  }, []);

  // Keep the access token fresh while the app is open.
  useEffect(() => {
    if (!session) return;
    const due = new Date(session.accessTokenExpiresAt).getTime() - Date.now() - REFRESH_MARGIN_MS;
    const timer = setTimeout(() => void api.refresh().catch(() => undefined), Math.max(due, 5_000));
    return () => clearTimeout(timer);
  }, [session]);

  const login = useCallback(async (loginName: string, password: string) => {
    api.setSession(await api.post<AuthTokenResponse>("/auth/login", { login: loginName, password }));
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await api.post<RegisterResponse>("/auth/register", input);
    if (res.session) api.setSession(res.session);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      api.setSession(null);
    }
  }, []);

  const setUser = useCallback((user: CurrentUser) => {
    if (api.current) api.setSession({ ...api.current, user });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user: session?.user ?? null, login, register, logout, setUser }),
    [status, session, login, register, logout, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in user (only inside <RequireAuth>). */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) throw new Error("No signed-in user");
  return user;
}

/** Renders children only for signed-in users; sends everyone else to the login page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <WorldLoading text="Signing you in…" />;
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

/** Only allows same-site relative paths as post-login destinations (no open redirects). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/world";
}
