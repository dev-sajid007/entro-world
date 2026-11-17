import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { AuthProvider, RequireAuth } from "../features/auth/AuthContext";
import { LoginPage, RegisterPage, VerifyEmailPage } from "../features/auth/AuthPages";
import { WorldSessionProvider } from "../features/world/WorldSession";
import { WorldLoading } from "../features/world/WorldLayer";
import LandingPage from "./LandingPage";

const SandboxPage = lazy(() => import("../features/world/SandboxPage"));
const DevMultiplayerPage = lazy(() => import("../features/world/DevMultiplayerPage"));
const WorldPage = lazy(() => import("../features/world/WorldPage"));
const FeedPage = lazy(() => import("../features/social/FeedPage"));
const ProfilePage = lazy(() => import("../features/social/ProfilePage"));
const FriendsPage = lazy(() => import("../features/social/FriendsPage"));
const SettingsPage = lazy(() => import("../features/social/SettingsPage"));

const authed = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorldSessionProvider>
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<WorldLoading text="Loading…" />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/sandbox" element={<SandboxPage />} />
                <Route path="/world" element={authed(<WorldPage />)} />
                <Route path="/feed" element={authed(<FeedPage />)} />
                <Route path="/friends" element={authed(<FriendsPage />)} />
                <Route path="/settings" element={authed(<SettingsPage />)} />
                <Route path="/u/:username" element={authed(<ProfilePage />)} />
                {import.meta.env.DEV && <Route path="/dev/multiplayer" element={<DevMultiplayerPage />} />}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </WorldSessionProvider>
    </QueryClientProvider>
  );
}
