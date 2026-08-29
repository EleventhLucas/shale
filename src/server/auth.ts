import type { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppConfig } from "./config";

const sessionCookie = "shale_edit_session";
const maxAttempts = 5;
const attemptWindowMs = 60_000;
const throttleCapacity = 256;

type SessionRow = { expires_at: string };
type Attempt = { count: number; resetAt: number };

export type AppVariables = {
  Variables: Record<string, never>;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalSecret(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export function createAuth(db: Database, config: AppConfig) {
  const passwordFingerprint = config.password ? sha256(config.password) : undefined;
  const attempts = new Map<string, Attempt>();

  function clientKey(headers: Headers): string {
    return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
  }

  function throttled(key: string): boolean {
    const timestamp = Date.now();
    const current = attempts.get(key);
    if (!current || current.resetAt <= timestamp) {
      attempts.set(key, { count: 0, resetAt: timestamp + attemptWindowMs });
      return false;
    }
    return current.count >= maxAttempts;
  }

  function recordFailure(key: string): void {
    const current = attempts.get(key);
    if (current) current.count += 1;
    if (attempts.size > throttleCapacity) {
      const oldest = attempts.keys().next().value;
      if (oldest) attempts.delete(oldest);
    }
  }

  function sessionFromToken(token: string | undefined): SessionRow | null {
    if (!token || !passwordFingerprint) return null;
    const row = db
      .query(
        "SELECT expires_at FROM sessions WHERE token_hash = ? AND password_fingerprint = ? AND expires_at > ?",
      )
      .get(sha256(token), passwordFingerprint, new Date().toISOString()) as SessionRow | null;
    return row ?? null;
  }

  function sessionState(token: string | undefined): {
    unlocked: boolean;
    expiresAt: string | null;
    passwordRequired: boolean;
  } {
    if (!passwordFingerprint) {
      return { unlocked: true, expiresAt: null, passwordRequired: false };
    }
    const session = sessionFromToken(token);
    return {
      unlocked: Boolean(session),
      expiresAt: session?.expires_at ?? null,
      passwordRequired: true,
    };
  }

  function issueSession(): { token: string; expiresAt: string } {
    if (!passwordFingerprint) throw new Error("Editing does not require a session.");
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + config.sessionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.query("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt.toISOString());
    db.query(
      "INSERT INTO sessions (token_hash, password_fingerprint, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).run(sha256(token), passwordFingerprint, expiresAt, createdAt.toISOString());
    return { token, expiresAt };
  }

  const requireSession: MiddlewareHandler<AppVariables> = async (c, next) => {
    if (!passwordFingerprint) {
      await next();
      return;
    }
    if (!sessionFromToken(getCookie(c, sessionCookie))) {
      return c.json({ error: "Editing is locked." }, 401);
    }
    await next();
  };

  return {
    passwordRequired: Boolean(passwordFingerprint),
    passwordMatches: (candidate: string) =>
      Boolean(config.password && equalSecret(candidate, config.password)),
    sessionState,
    issueSession,
    requireSession,
    throttled,
    recordFailure,
    clearFailures: (key: string) => attempts.delete(key),
    clientKey,
    setSessionCookie: (
      context: Parameters<typeof setCookie>[0],
      token: string,
      expiresAt: string,
    ) =>
      setCookie(context, sessionCookie, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.publicOrigin?.startsWith("https://") ?? false,
        path: "/",
        expires: new Date(expiresAt),
      }),
    clearSession: (context: Parameters<typeof deleteCookie>[0]) => {
      const token = getCookie(context, sessionCookie);
      if (token) db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
      deleteCookie(context, sessionCookie, { path: "/" });
    },
    tokenFromContext: (context: Parameters<typeof getCookie>[0]) =>
      getCookie(context, sessionCookie),
  };
}
