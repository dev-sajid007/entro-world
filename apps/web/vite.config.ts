import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL("../..", import.meta.url).pathname, "");
  const apiTarget = env.VITE_API_PROXY ?? `http://localhost:${env.API_PORT ?? 3001}`;
  const gameTarget = env.VITE_GAME_PROXY ?? `http://localhost:${env.GAME_PORT ?? 2567}`;
  return {
    plugins: [react()],
    envDir: "../..",
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true, ws: true },
        "/game": {
          target: gameTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/game/, ""),
        },
      },
    },
    preview: { port: 4173 },
    build: {
      target: "es2022",
      sourcemap: true,
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/three") || id.includes("@react-three")) return "three";
            if (id.includes("rapier")) return "physics";
            if (id.includes("livekit")) return "voice";
            return undefined;
          },
        },
      },
    },
  };
});
