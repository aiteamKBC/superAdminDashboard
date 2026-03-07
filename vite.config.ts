import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const coreTarget = env.VITE_API_PROXY_TARGET || "https://api.kentbusinesscollege.net";
  const usersTarget = env.VITE_USERS_API_PROXY_TARGET || coreTarget;

  return {
    server: {
      proxy: {
        "/api": {
          target: coreTarget,
          changeOrigin: true,
          secure: true,
        },
        "/users-api": {
          target: usersTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
  };
});