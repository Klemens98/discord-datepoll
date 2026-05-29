import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const webEnv = loadEnv(mode, ".", "");
  const discordClientId =
    webEnv.VITE_DISCORD_CLIENT_ID || rootEnv.VITE_DISCORD_CLIENT_ID || rootEnv.DISCORD_CLIENT_ID || "";

  return {
  plugins: [react()],
  define: {
    "import.meta.env.VITE_DISCORD_CLIENT_ID": JSON.stringify(discordClientId)
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    globals: true
  }
};
});
