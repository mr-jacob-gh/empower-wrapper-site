import { defineConfig } from "vite";

// Relative base so the build works at https://<user>.github.io/<repo>/ without
// hard-coding the repo name.
export default defineConfig({
  base: "./",
  server: {
    // In `npm run dev`, calls to /api/* are proxied to the local service, so
    // development works even before the service sends CORS headers.
    proxy: {
      "/api": {
        target: "http://localhost:5055",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
