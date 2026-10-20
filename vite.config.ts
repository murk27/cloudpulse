/**
 * Vite config for the React frontend (web/).
 * - `npm run dev:web` serves it on http://localhost:5173 and proxies /api to the local API server.
 * - `npm run build:web` writes static files to dist/web, which deploy.sh uploads to S3.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    // Recharts makes the bundle ~650 kB (~195 kB gzipped). That's fine for this app.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    // In production CloudFront routes /api/* to API Gateway. Locally we mimic that with a proxy.
    proxy: { "/api": "http://localhost:3001" },
  },
});
