import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET } = loadEnv(
    mode,
    new URL(".", import.meta.url).pathname,
    "API_PROXY_TARGET",
  );
  return {
    plugins: [react()],
    server: {
      port: 5175,
      strictPort: true,
      proxy: {
        ...Object.fromEntries(
          ["/api", "/sanctum", "/auth/sso"].map((path) => [
            path,
            {
              target: API_PROXY_TARGET || "http://127.0.0.1:8000",
              changeOrigin: false,
            },
          ]),
        ),
      },
    },
  };
});
