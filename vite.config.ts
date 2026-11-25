import { defineConfig } from "vite";

// Relative base so the build works at https://<user>.github.io/<repo>/ without
// hard-coding the repo name.
export default defineConfig({
  base: "./",
  server: {
    // In dev, /api/* is proxied to the service, so no CORS setup is needed for
    // localhost:5173. The service has a Let's Encrypt certificate, which Node
    // trusts by default. Override with EMPOWER_DEV_TARGET if it moves.
    proxy: {
      "/api": {
        target: process.env.EMPOWER_DEV_TARGET ?? "https://beefjerky67.asuscomm.com:44300",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
