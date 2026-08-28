import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/_shale": {
        target: "http://localhost:3000",
        changeOrigin: false,
      },
      "/healthz": "http://localhost:3000",
    },
  },
});
