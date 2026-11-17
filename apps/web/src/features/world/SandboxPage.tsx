import { useEffect } from "react";
import { generateAvatar } from "@entroworld/avatar";
import { useWorldSession } from "./WorldSession";
import { WorldLayer, WorldLoading } from "./WorldLayer";

/** Offline single-player sandbox: the 3D city with local physics only (Milestone 1). */
export default function SandboxPage() {
  const session = useWorldSession();
  const { start, stop } = session;

  useEffect(() => {
    void start({ mode: "offline", userId: null, username: "explorer", displayName: "Explorer", avatar: generateAvatar("explorer") });
    return () => void stop();
  }, [start, stop]);

  if (session.status === "error") return <WorldLoading text="" error={session.error} onRetry={() => window.location.reload()} />;
  if (!session.engine || session.mode !== "offline") return <WorldLoading text="Building the city…" />;
  return <WorldLayer engine={session.engine} hudVisible />;
}
