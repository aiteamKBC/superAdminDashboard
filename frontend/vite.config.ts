import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const localDjangoTarget = env.VITE_LOCAL_DJANGO_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    server: {
      proxy: {
        "/api": {
          target: localDjangoTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
  };
});
