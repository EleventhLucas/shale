import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppConfig = {
  password?: string;
  port: number;
  dataDir: string;
  publicOrigin?: string;
  sessionDays: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer configuration value.");
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const inlinePassword = env.SHALE_PASSWORD || undefined;
  const passwordFile = env.SHALE_PASSWORD_FILE || undefined;
  if (inlinePassword && passwordFile) {
    throw new Error("Set no more than one of SHALE_PASSWORD or SHALE_PASSWORD_FILE.");
  }

  const password =
    inlinePassword ??
    (passwordFile ? readFileSync(resolve(passwordFile), "utf8").trimEnd() : undefined);
  if (passwordFile && !password) {
    throw new Error("The Shale password file must not be empty.");
  }

  const publicOrigin = env.SHALE_PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (publicOrigin && !URL.canParse(publicOrigin)) {
    throw new Error("SHALE_PUBLIC_ORIGIN must be an absolute URL.");
  }

  return {
    password,
    port: positiveInteger(env.SHALE_PORT, 3000),
    dataDir: resolve(env.SHALE_DATA_DIR ?? "/data"),
    publicOrigin,
    sessionDays: 30,
  };
}
