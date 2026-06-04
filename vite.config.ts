import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(projectRoot, ".env") });

const DASHBOARD_PORT = Number(process.env.PORT) || 3000;
const PROXY_PORT = Number(process.env.PROXY_PORT) || 3001;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
  },
  server: {
    port: DASHBOARD_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${PROXY_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
