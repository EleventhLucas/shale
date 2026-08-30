/// <reference types="bun" />

import { execFileSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function gitValue(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function commitValue(value: string | undefined): string {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized && /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : "unknown";
}

function dateValue(value: string | undefined): string {
  const match = value?.trim().match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/);
  return match ? `${match[1]}.${Number(match[2])}.${Number(match[3])}` : "unknown";
}

const buildCommit = commitValue(process.env.SHALE_BUILD_COMMIT ?? gitValue(["rev-parse", "HEAD"]));
const buildDate = dateValue(
  process.env.SHALE_BUILD_DATE ?? gitValue(["show", "-s", "--format=%cs", "HEAD"]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __SHALE_BUILD_COMMIT__: JSON.stringify(buildCommit),
    __SHALE_BUILD_DATE__: JSON.stringify(buildDate),
  },
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
