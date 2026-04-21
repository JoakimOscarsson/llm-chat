import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type EnvLike = Record<string, string | undefined>;

export function resolveApiProxyTarget(env: EnvLike = process.env): string {
  return env.WEB_API_PROXY_TARGET ?? "http://api-gateway:4000";
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: resolveApiProxyTarget(),
        changeOrigin: true
      }
    }
  }
});
